#!/usr/bin/env node
/**
 * Benchmark runner for ArgMining paper (v2 — Aphorist integrated).
 *
 * Usage:
 *   cd apps/api && npx tsx src/jobs/runBenchmark.ts \
 *     --input /Users/mh/Documents/Argumentmining/threads.jsonl \
 *     --output /tmp/benchmark-results.json \
 *     --api http://localhost:3001 \
 *     --limit 100
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseArgs } from 'util';
import { loadCMVThreads } from './cmvLoader.js';
import { PostRepo, ReplyRepo } from '../db/repositories/index.js';
import { enqueueV3Analysis } from './enqueueV3Analysis.js';
import { getPool, closePool } from '../db/pool.js';

const DEV_USER_ID = 'dev_user';

// ── CLI args ──────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    input:   { type: 'string' },
    output:  { type: 'string', default: '/tmp/benchmark-results.json' },
    api:     { type: 'string', default: 'http://localhost:3001' },
    limit:   { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: false,
});

const inputPath  = args['input'] as string | undefined;
const outputFile = args['output'] as string;
const apiBase    = args['api'] as string;
const limit      = args['limit'] ? parseInt(args['limit'] as string, 10) : undefined;
const dryRun     = args['dry-run'] as boolean;

if (!inputPath) {
  console.error('Error: --input <path> is required');
  process.exit(1);
}

// ── Metric helpers ────────────────────────────────────────────────────────

interface RankedNode {
  id: string;
  text: string;
  rank: number;
  score: number;
  depth: number;
  parent_id: string | null;
  parent_text: string | null;
}

function flattenTree(items: unknown[], rank = { value: 0 }, parentId: string | null = null): RankedNode[] {
  const result: RankedNode[] = [];
  for (const item of items as Array<Record<string, unknown>>) {
    rank.value += 1;
    result.push({
      id: item['id'] as string,
      text: item['content'] as string,
      rank: rank.value,
      score: (item['final_score'] as number) ?? 0,
      depth: (item['depth'] as number) ?? 0,
      parent_id: parentId,
      parent_text: null, // filled below
    });
    const children = item['children'] as unknown[] | undefined;
    if (children && children.length > 0) {
      result.push(...flattenTree(children, rank, item['id'] as string));
    }
  }
  return result;
}

function reciprocalRank(results: RankedNode[], deltaIds: Set<string>): number {
  for (const r of results) {
    if (deltaIds.has(r.id)) return 1 / r.rank;
  }
  return 0;
}

function ndcg(results: RankedNode[], deltaIds: Set<string>, k: number): number {
  const dcg = results.slice(0, k).reduce((acc, r, i) => {
    const rel = deltaIds.has(r.id) ? 1 : 0;
    return acc + rel / Math.log2(i + 2);
  }, 0);
  const numRelevant = Math.min(deltaIds.size, k);
  const idcg = Array.from({ length: numRelevant }, (_, i) => 1 / Math.log2(i + 2))
    .reduce((a, b) => a + b, 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

// ── Output schema ─────────────────────────────────────────────────────────

interface ThreadResult {
  test_id: string;
  parent_argument: string;
  delta_reply_ids: string[];
  algorithms: {
    Alg_A: RankedNode[];
    Alg_B: RankedNode[];
  };
  metrics: {
    Alg_A: { rr: number; ndcg5: number; ndcg10: number };
    Alg_B: { rr: number; ndcg5: number; ndcg10: number };
  };
}

interface BenchmarkOutput {
  dataset: string;
  generated_at: string;
  thread_count: number;
  summary: {
    Alg_A: { mrr: number; ndcg5: number; ndcg10: number; win_rate: number };
    Alg_B: { mrr: number; ndcg5: number; ndcg10: number; win_rate: number };
  };
  threads: ThreadResult[];
}

// ── Ingest helpers ────────────────────────────────────────────────────────

function contentHash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function pollUntilComplete(
  postIds: string[],
  apiBase: string,
  timeoutMs = 6 * 60 * 60 * 1000,
  pollIntervalMs = 60_000
): Promise<void> {
  const start = Date.now();
  const remaining = new Set(postIds);

  while (remaining.size > 0) {
    if (Date.now() - start > timeoutMs) {
      console.error(`\nTimeout: ${remaining.size} posts still pending/processing:`);
      for (const id of remaining) console.error(`  ${id}`);
      throw new Error('Poll timeout exceeded');
    }

    let completed = 0, processing = 0, pending = 0, failed = 0;

    for (const postId of [...remaining]) {
      const resp = await fetch(`${apiBase}/api/v3/status/post/${postId}`, {
        headers: { Authorization: 'Bearer dev_token' },
      });
      if (!resp.ok) { pending++; continue; }
      const data = await resp.json() as { data?: { status?: string } };
      const status = data.data?.status;
      if (status === 'completed') { remaining.delete(postId); completed++; }
      else if (status === 'processing') processing++;
      else if (status === 'failed') { remaining.delete(postId); failed++; }
      else pending++;
    }

    const total = postIds.length;
    const done = total - remaining.size;
    const elapsed = Math.floor((Date.now() - start) / 60000);
    const bar = '[' + '='.repeat(Math.floor(done / total * 20)) + '-'.repeat(20 - Math.floor(done / total * 20)) + ']';
    process.stdout.write(`\r${bar} ${done}/${total} complete  (${processing} processing, ${pending} pending, ${failed} failed) [${elapsed}m elapsed]`);

    if (remaining.size === 0) break;
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  console.log();
}

async function main() {
  // Initialize DB pool
  getPool();

  console.log(`Loading CMV threads from: ${inputPath}`);
  const threads = await loadCMVThreads(inputPath!, limit);
  console.log(`Loaded ${threads.length} threads`);

  if (threads.length === 0) {
    console.error('No valid threads found.');
    process.exit(1);
  }

  // ── Step 1: Ingest ──
  console.log('\n[1/4] Ingesting threads into Aphorist...');

  // In-memory mapping: threadId → { post_id, cmv_id→reply_id, delta_reply_ids }
  const mapping = new Map<string, {
    post_id: string;
    cmv_to_reply: Map<string, string>;
    delta_reply_ids: string[];
  }>();

  for (const thread of threads) {
    const opText = thread.nodes.find(n => n.id === thread.focalNodeId)?.text ?? '';
    const opHash = contentHash(opText);

    // Check if already ingested (by checking if post with this hash exists)
    // We use the hash as a tag in the title to make it idempotent
    const title = `[cmv:${thread.threadId}:${opHash}]`;

    // Check if already ingested by title (idempotent)
    let postId: string;
    const pool = getPool();
    const { rows: existingRows } = await pool.query<{ id: string }>(
      `SELECT id FROM posts WHERE title = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
      [title]
    );
    const existingPost = existingRows[0] ?? null;
    if (existingPost) {
      postId = existingPost.id;
    } else {
      try {
        const post = await PostRepo.create(DEV_USER_ID, { title, content: opText });
        postId = post.id;
        enqueueV3Analysis('post', postId, opText).catch(() => {});
      } catch (err: unknown) {
        console.warn(`\nSkipping duplicate thread ${thread.threadId}`);
        continue;
      }
    }

    const cmvToReply = new Map<string, string>();
    cmvToReply.set(thread.focalNodeId, postId);

    if (existingPost) {
      // Post already ingested — reconstruct cmvToReply by matching reply content hashes
      const { rows } = await pool.query<{ id: string; analysis_content_hash: string }>(
        'SELECT id, analysis_content_hash FROM replies WHERE post_id = $1 AND deleted_at IS NULL',
        [postId]
      );
      // analysis_content_hash in DB is full 64-char SHA256; contentHash() is truncated to 16 chars
      // Match on the first 16 chars of the stored hash
      const hashToReplyId = new Map(rows.map(r => [r.analysis_content_hash.slice(0, 16), r.id]));
      for (const node of thread.nodes) {
        if (node.id === thread.focalNodeId) continue;
        const hash = contentHash(node.text);
        const replyId = hashToReplyId.get(hash);
        if (replyId) cmvToReply.set(node.id, replyId);
      }
      console.log(`  Thread ${thread.threadId}: already ingested (post ${postId}), reconstructed ${cmvToReply.size - 1} reply mappings`);
    } else {
      console.log(`  Thread ${thread.threadId}: ${thread.nodes.length} nodes, ${thread.edges.length} edges, focal=${thread.focalNodeId}`);
      const directChildren = thread.edges.filter(e => e.to_node_id === thread.focalNodeId);
      console.log(`  Direct children of focal: ${directChildren.length}`);

      // Process comments in BFS order (level by level)
      const levelQueue: string[] = [thread.focalNodeId];
      const processed = new Set<string>([thread.focalNodeId]);

      while (levelQueue.length > 0) {
        const currentId = levelQueue.shift()!;
        const children = thread.edges
          .filter(e => e.to_node_id === currentId)
          .map(e => e.from_node_id);

        for (const childId of children) {
          if (processed.has(childId)) continue;
          processed.add(childId);

          const node = thread.nodes.find(n => n.id === childId);
          if (!node) continue;

          const parentReplyId = cmvToReply.get(currentId);
          const isDirectReplyToPost = currentId === thread.focalNodeId;

          try {
            const reply = await ReplyRepo.create(postId, DEV_USER_ID, {
              content: node.text,
              parent_reply_id: isDirectReplyToPost ? undefined : parentReplyId,
            });
            cmvToReply.set(childId, reply.id);

            const replyParent = isDirectReplyToPost
              ? { sourceType: 'post' as const, sourceId: postId }
              : { sourceType: 'reply' as const, sourceId: parentReplyId! };
            enqueueV3Analysis('reply', reply.id, node.text, replyParent).catch(() => {});
          } catch (err) {
            console.warn(`  Reply create failed for ${childId}: ${err instanceof Error ? err.message : String(err)}`);
          }
          levelQueue.push(childId);
        }
      }
    }

    const deltaReplyIds = thread.deltaCommentIds
      .map(cmvId => cmvToReply.get(cmvId))
      .filter((id): id is string => id !== undefined);

    mapping.set(thread.threadId, {
      post_id: postId,
      cmv_to_reply: cmvToReply,
      delta_reply_ids: deltaReplyIds,
    });
  }

  const ingestedPostIds = [...mapping.values()].map(m => m.post_id);
  console.log(`Ingested ${ingestedPostIds.length} threads`);

  if (ingestedPostIds.length === 0) {
    console.error('Nothing to evaluate.');
    process.exit(1);
  }

  // ── Step 2: Poll ──
  if (!dryRun) {
    console.log('\n[2/4] Waiting for V3 analysis to complete...');
    await pollUntilComplete(ingestedPostIds, apiBase);
  } else {
    console.log('\n[2/4] Dry run: skipping poll');
  }

  // ── Step 3: Evaluate ──
  console.log('\n[3/4] Evaluating with benchmark API...');
  const results: ThreadResult[] = [];

  for (const [threadId, info] of mapping) {
    const resp = await fetch(`${apiBase}/api/benchmark/thread/${info.post_id}`, {
      headers: { Authorization: 'Bearer dev_token' },
    });

    if (!resp.ok) {
      console.warn(`Skipping thread ${threadId}: benchmark API returned ${resp.status}`);
      continue;
    }

    const data = await resp.json() as {
      post_id: string;
      parent_argument: string;
      alg_a: { items: unknown[] };
      alg_b: { items: unknown[] };
    };

    if (!data.alg_a?.items?.length && !data.alg_b?.items?.length) {
      console.warn(`Skipping thread ${threadId}: empty results (analysis may not have completed)`);
      continue;
    }

    const rankA = flattenTree(data.alg_a.items ?? []);
    const rankB = flattenTree(data.alg_b.items ?? []);

    // Map cmv delta IDs to Aphorist reply IDs
    const deltaSet = new Set(info.delta_reply_ids);

    const rrA   = reciprocalRank(rankA, deltaSet);
    const rrB   = reciprocalRank(rankB, deltaSet);
    const n5A   = ndcg(rankA, deltaSet, 5);
    const n5B   = ndcg(rankB, deltaSet, 5);
    const n10A  = ndcg(rankA, deltaSet, 10);
    const n10B  = ndcg(rankB, deltaSet, 10);

    results.push({
      test_id: `cmv_thread_${threadId}`,
      parent_argument: data.parent_argument,
      delta_reply_ids: info.delta_reply_ids,
      algorithms: { Alg_A: rankA, Alg_B: rankB },
      metrics: {
        Alg_A: { rr: rrA, ndcg5: n5A, ndcg10: n10A },
        Alg_B: { rr: rrB, ndcg5: n5B, ndcg10: n10B },
      },
    });
  }

  // ── Step 4: Aggregate ──
  console.log(`\n[4/4] Aggregating ${results.length} results...`);

  const n = results.length;
  if (n === 0) {
    console.error('No results to aggregate.');
    process.exit(1);
  }

  const mean = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;
  const mrrA   = mean(results.map(r => r.metrics.Alg_A.rr));
  const mrrB   = mean(results.map(r => r.metrics.Alg_B.rr));
  const ndcg5A = mean(results.map(r => r.metrics.Alg_A.ndcg5));
  const ndcg5B = mean(results.map(r => r.metrics.Alg_B.ndcg5));
  const ndcg10A = mean(results.map(r => r.metrics.Alg_A.ndcg10));
  const ndcg10B = mean(results.map(r => r.metrics.Alg_B.ndcg10));
  const winsA = results.filter(r => r.metrics.Alg_A.rr > r.metrics.Alg_B.rr).length;
  const winsB = results.filter(r => r.metrics.Alg_B.rr > r.metrics.Alg_A.rr).length;

  const output: BenchmarkOutput = {
    dataset: 'webis-cmv-20',
    generated_at: new Date().toISOString(),
    thread_count: n,
    summary: {
      Alg_A: { mrr: mrrA, ndcg5: ndcg5A, ndcg10: ndcg10A, win_rate: winsA / n },
      Alg_B: { mrr: mrrB, ndcg5: ndcg5B, ndcg10: ndcg10B, win_rate: winsB / n },
    },
    threads: results,
  };

  console.log('\n=== Benchmark Summary ===');
  console.log(`Threads evaluated: ${n}`);
  console.log(`\nAlgorithm A (EvidenceRank):`);
  console.log(`  MRR:     ${mrrA.toFixed(4)}`);
  console.log(`  nDCG@5:  ${ndcg5A.toFixed(4)}`);
  console.log(`  nDCG@10: ${ndcg10A.toFixed(4)}`);
  console.log(`  Win rate: ${(winsA / n * 100).toFixed(1)}%`);
  console.log(`\nAlgorithm B (WeightedBipolar):`);
  console.log(`  MRR:     ${mrrB.toFixed(4)}`);
  console.log(`  nDCG@5:  ${ndcg5B.toFixed(4)}`);
  console.log(`  nDCG@10: ${ndcg10B.toFixed(4)}`);
  console.log(`  Win rate: ${(winsB / n * 100).toFixed(1)}%`);

  if (!dryRun) {
    const outPath = path.resolve(outputFile);
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\nResults written to: ${outPath}`);
  } else {
    console.log('\n[dry-run] No output file written.');
    if (results.length > 0) {
      console.log('\nFirst thread sample:');
      console.log(JSON.stringify(results[0], null, 2));
    }
  }

  await closePool();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
