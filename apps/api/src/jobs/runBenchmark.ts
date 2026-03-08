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
import { fetch as undiciFetch, Agent } from 'undici';
import { loadCMVThreads } from './cmvLoader.js';

// Disable timeouts for the benchmark API call — LLM scoring + HC can take > 5 min per thread
const benchmarkAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
import { PostRepo, ReplyRepo } from '../db/repositories/index.js';
import { enqueueV3Analysis } from './enqueueV3Analysis.js';
import { getPool, closePool } from '../db/pool.js';
import { v3Queue } from './v3Queue.js';
import { graphProcessorQueue } from './graphProcessorQueue.js';

const DEV_USER_ID = 'dev_user';

// ── CLI args ──────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    input:   { type: 'string' },
    output:  { type: 'string', default: '/tmp/benchmark-results.json' },
    api:     { type: 'string', default: 'http://localhost:3001' },
    limit:   { type: 'string' },
    exclude: { type: 'string' }, // comma-separated CMV thread IDs to skip
    'dry-run':   { type: 'boolean', default: false },
    'reanalyze': { type: 'boolean', default: false },
  },
  strict: false,
});

const inputPath  = args['input'] as string | undefined;
const outputFile = args['output'] as string;
const apiBase    = args['api'] as string;
const limit      = args['limit'] ? parseInt(args['limit'] as string, 10) : undefined;
const excludeIds = args['exclude'] ? new Set((args['exclude'] as string).split(',').map(s => s.trim())) : undefined;
const dryRun     = args['dry-run'] as boolean;
const reanalyze  = args['reanalyze'] as boolean;

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

/** Returns the rank of the first relevant result, or null if none found. */
function firstRelevantRank(results: RankedNode[], deltaIds: Set<string>): number | null {
  for (const r of results) {
    if (deltaIds.has(r.id)) return r.rank;
  }
  return null;
}

// ── Output schema ─────────────────────────────────────────────────────────

type AlgMetrics = { rr: number; rank: number | null };
type AlgSummary = { mrr: number; mean_rank: number | null; median_rank: number | null; rank_std: number | null; win_rate: number };

type AlgKey = 'Top'
  | 'EvidenceRank_Vote'              | 'EvidenceRank_Vote_NoBridge'
  | 'EvidenceRank_Vote_D95'
  | 'QuadraticEnergy_Vote'           | 'QuadraticEnergy_Vote_NoBridge'
  | 'DampedModular_ReferenceBias_NoBridge'
  | 'DampedModular_Vote_HC_NoBridge'
  | 'Combined_ER_QE_Vote';

interface RawThreadData {
  focalNodeId: string;
  nodes: Array<{ id: string; vote_score: number; source_type: string; source_id: string }>;
  edges: Array<{ from_node_id: string; to_node_id: string; direction: string; confidence: number }>;
  nodeTargets: Array<[string, string[]]>;
}

interface ThreadResult {
  test_id: string;
  parent_argument: string;
  delta_reply_ids: string[];
  algorithms: Record<AlgKey, RankedNode[]>;
  metrics: Record<AlgKey, AlgMetrics>;
  raw_data?: RawThreadData;
}

interface BenchmarkOutput {
  dataset: string;
  generated_at: string;
  thread_count: number;
  summary: Record<AlgKey, AlgSummary>;
  threads: ThreadResult[];
}

// ── Ingest helpers ────────────────────────────────────────────────────────

function contentHash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** Remove a BullMQ job by its derived jobId so it can be re-enqueued. */
async function removeBullMQJob(sourceType: 'post' | 'reply', sourceId: string, content: string): Promise<void> {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const jobId = `v3-${sourceType}-${sourceId}-${hash.substring(0, 8)}`;
  const job = await v3Queue.getJob(jobId);
  if (job) await job.remove();
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
  const threads = await loadCMVThreads(inputPath!, limit, excludeIds);
  console.log(`Loaded ${threads.length} threads`);

  if (threads.length === 0) {
    console.error('No valid threads found.');
    process.exit(1);
  }

  // ── Step 1: Ingest ──
  // Ingest in batches of INGEST_BATCH_SIZE threads, polling for V3 completion
  // between batches. This prevents dumping tens of thousands of Gemini jobs
  // into the queue at once, which triggers rate-limit model degradation.
  const INGEST_BATCH_SIZE = 30;
  console.log(`\n[1/4] Ingesting threads into Aphorist (batches of ${INGEST_BATCH_SIZE})...`);

  // In-memory mapping: threadId → { post_id, cmv_id→reply_id, delta_reply_ids }
  const mapping = new Map<string, {
    post_id: string;
    cmv_to_reply: Map<string, string>;
    delta_reply_ids: string[];
  }>();

  for (let batchStart = 0; batchStart < threads.length; batchStart += INGEST_BATCH_SIZE) {
    const batchThreads = threads.slice(batchStart, batchStart + INGEST_BATCH_SIZE);
    const batchLabel = `${batchStart + 1}–${Math.min(batchStart + INGEST_BATCH_SIZE, threads.length)}/${threads.length}`;
    console.log(`\n  Batch ${batchLabel}`);
    const newPostIds: string[] = [];

  for (const thread of batchThreads) {
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
        newPostIds.push(postId);
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

      if (reanalyze) {
        // Delete existing analysis runs and BullMQ jobs so the new engine re-processes them
        await pool.query(
          `DELETE FROM v3_analysis_runs WHERE source_type = $1 AND source_id = $2`,
          ['post', postId]
        );
        await removeBullMQJob('post', postId, opText);
        enqueueV3Analysis('post', postId, opText).catch(() => {});

        for (const node of thread.nodes) {
          if (node.id === thread.focalNodeId) continue;
          const replyId = cmvToReply.get(node.id);
          if (!replyId) continue;
          await pool.query(
            `DELETE FROM v3_analysis_runs WHERE source_type = $1 AND source_id = $2`,
            ['reply', replyId]
          );
          await removeBullMQJob('reply', replyId, node.text);
          // Reconstruct parent for enqueue
          const parentCmvId = thread.edges.find(e => e.from_node_id === node.id)?.to_node_id;
          const isDirectChild = parentCmvId === thread.focalNodeId;
          const parentReplyId = parentCmvId ? cmvToReply.get(parentCmvId) : undefined;
          const replyParent = isDirectChild
            ? { sourceType: 'post' as const, sourceId: postId }
            : parentReplyId
              ? { sourceType: 'reply' as const, sourceId: parentReplyId }
              : undefined;
          enqueueV3Analysis('reply', replyId, node.text, replyParent).catch(() => {});
        }
        console.log(`    [reanalyze] Deleted runs+jobs and re-enqueued post + ${cmvToReply.size - 1} replies`);
      }
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

    // Store CMV vote scores in DB so Top/ER_Vote have meaningful signals
    for (const node of thread.nodes) {
      if (node.id === thread.focalNodeId) continue; // skip OP (it's a post, not reply)
      const replyId = cmvToReply.get(node.id);
      if (replyId && node.vote_score !== 0) {
        pool.query('UPDATE replies SET score=$1 WHERE id=$2 AND score=0', [node.vote_score, replyId]).catch(() => {});
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
  } // end thread loop

    // Poll V3 completion for any newly-ingested threads in this batch before
    // proceeding to the next batch (keeps Gemini queue bounded).
    if (!dryRun && newPostIds.length > 0) {
      console.log(`  Waiting for V3 analysis on ${newPostIds.length} new threads...`);
      await pollUntilComplete(newPostIds, apiBase);
      console.log(`  Batch ${batchLabel} done.\n`);
    }
  } // end batch loop

  const ingestedPostIds = [...mapping.values()].map(m => m.post_id);
  console.log(`Ingested ${ingestedPostIds.length} threads`);

  if (ingestedPostIds.length === 0) {
    console.error('Nothing to evaluate.');
    process.exit(1);
  }

  // ── Step 2: Poll (catch-up for already-ingested threads) ──
  if (!dryRun) {
    console.log('\n[2/5] Waiting for V3 analysis to complete (already-ingested threads)...');
    await pollUntilComplete(ingestedPostIds, apiBase);
  } else {
    console.log('\n[2/5] Dry run: skipping poll');
  }

  // ── Step 2.5: Run nightly graph processor (EvidenceRank + IBA) ──
  if (!dryRun) {
    console.log('\n[3/5] Running nightly graph processor (EvidenceRank + QuadraticEnergy)...');
    const ngpJob = await graphProcessorQueue.add('benchmark-trigger', {}, {
      jobId: `benchmark-nightly-${Date.now()}`,
    });
    const ngpJobId = ngpJob.id!;
    const ngpStart = Date.now();
    const ngpTimeoutMs = 30 * 60 * 1000;
    while (true) {
      if (Date.now() - ngpStart > ngpTimeoutMs) {
        throw new Error('Nightly graph processor timed out after 30 minutes');
      }
      const j = await graphProcessorQueue.getJob(ngpJobId);
      const state = await j?.getState();
      process.stdout.write(`\r  Graph processor: ${state ?? 'unknown'} [${Math.floor((Date.now() - ngpStart) / 1000)}s elapsed]`);
      if (state === 'completed') { console.log(); break; }
      if (state === 'failed') throw new Error('Nightly graph processor job failed');
      await new Promise(r => setTimeout(r, 5000));
    }
  } else {
    console.log('\n[3/5] Dry run: skipping graph processor');
  }

  // ── Step 4: Evaluate ──
  console.log('\n[4/5] Evaluating with benchmark API (parallel)...');
  const results: ThreadResult[] = [];

  const evalEntries = [...mapping.entries()];

  // Evaluate in batches of 20 to stay within the 60 req/min rate limit.
  type EvalResult = {
    threadId: string;
    info: (typeof evalEntries)[0][1];
    data: {
      post_id: string;
      parent_argument: string;
      top: { items: unknown[] };
      raw_data?: RawThreadData;
      EvidenceRank_Vote?:                    { items: RankedNode[] };
      EvidenceRank_Vote_NoBridge?:           { items: RankedNode[] };
      EvidenceRank_Vote_D95?:                { items: RankedNode[] };
      QuadraticEnergy_Vote?:                 { items: RankedNode[] };
      QuadraticEnergy_Vote_NoBridge?:        { items: RankedNode[] };
      DampedModular_ReferenceBias_NoBridge?: { items: RankedNode[] };
      DampedModular_Vote_HC_NoBridge?:       { items: RankedNode[] };
      Combined_ER_QE_Vote?:                  { items: RankedNode[] };
    };
  };

  const evalResults: (EvalResult | null)[] = [];
  const BATCH_SIZE = 20;
  for (let i = 0; i < evalEntries.length; i += BATCH_SIZE) {
    const batch = evalEntries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async ([threadId, info]) => {
        if (info.delta_reply_ids.length === 0) {
          console.warn(`Skipping thread ${threadId}: no delta replies mapped (ingestion may have failed)`);
          return null;
        }
        const resp = await undiciFetch(`${apiBase}/api/benchmark/thread/${info.post_id}?raw=1`, {
          headers: { Authorization: 'Bearer dev_token' },
          dispatcher: benchmarkAgent,
        });
        if (!resp.ok) {
          console.warn(`Skipping thread ${threadId}: benchmark API returned ${resp.status}`);
          return null;
        }
        return { threadId, info, data: await resp.json() as EvalResult['data'] };
      })
    );
    evalResults.push(...batchResults);
    if (i + BATCH_SIZE < evalEntries.length) await new Promise(r => setTimeout(r, 2000));
  }

  for (const result of evalResults) {
    if (!result) continue;
    const { threadId, info } = result;
    const data = result.data;

    if (!data.top?.items?.length) {
      console.warn(`Skipping thread ${threadId}: empty results (analysis may not have completed)`);
      continue;
    }

    const rankTop        = flattenTree(data.top.items ?? []);
    const rankErVote     = data.EvidenceRank_Vote?.items ?? [];
    const rankErVoteNB   = data.EvidenceRank_Vote_NoBridge?.items ?? [];
    const rankErVote95   = data.EvidenceRank_Vote_D95?.items ?? [];
    const rankQeVote     = data.QuadraticEnergy_Vote?.items ?? [];
    const rankQeVoteNB   = data.QuadraticEnergy_Vote_NoBridge?.items ?? [];
    const rankDmRefBiasNB = data.DampedModular_ReferenceBias_NoBridge?.items ?? [];
    const rankDmVoteHCNB     = data.DampedModular_Vote_HC_NoBridge?.items ?? [];
    const rankCombinedVote   = data.Combined_ER_QE_Vote?.items ?? [];

    const deltaSet = new Set(info.delta_reply_ids);

    results.push({
      test_id: `cmv_thread_${threadId}`,
      parent_argument: data.parent_argument,
      delta_reply_ids: info.delta_reply_ids,
      raw_data: data.raw_data,
      algorithms: {
        Top:                                 rankTop,
        EvidenceRank_Vote:                   rankErVote,
        EvidenceRank_Vote_NoBridge:          rankErVoteNB,
        EvidenceRank_Vote_D95:               rankErVote95,
        QuadraticEnergy_Vote:                rankQeVote,
        QuadraticEnergy_Vote_NoBridge:       rankQeVoteNB,
        DampedModular_ReferenceBias_NoBridge: rankDmRefBiasNB,
        DampedModular_Vote_HC_NoBridge:      rankDmVoteHCNB,
        Combined_ER_QE_Vote:                 rankCombinedVote,
      },
      metrics: {
        Top:                                 { rr: reciprocalRank(rankTop, deltaSet),             rank: firstRelevantRank(rankTop, deltaSet) },
        EvidenceRank_Vote:                   { rr: reciprocalRank(rankErVote, deltaSet),          rank: firstRelevantRank(rankErVote, deltaSet) },
        EvidenceRank_Vote_NoBridge:          { rr: reciprocalRank(rankErVoteNB, deltaSet),        rank: firstRelevantRank(rankErVoteNB, deltaSet) },
        EvidenceRank_Vote_D95:               { rr: reciprocalRank(rankErVote95, deltaSet),        rank: firstRelevantRank(rankErVote95, deltaSet) },
        QuadraticEnergy_Vote:                { rr: reciprocalRank(rankQeVote, deltaSet),          rank: firstRelevantRank(rankQeVote, deltaSet) },
        QuadraticEnergy_Vote_NoBridge:       { rr: reciprocalRank(rankQeVoteNB, deltaSet),        rank: firstRelevantRank(rankQeVoteNB, deltaSet) },
        DampedModular_ReferenceBias_NoBridge: { rr: reciprocalRank(rankDmRefBiasNB, deltaSet),   rank: firstRelevantRank(rankDmRefBiasNB, deltaSet) },
        DampedModular_Vote_HC_NoBridge:      { rr: reciprocalRank(rankDmVoteHCNB, deltaSet),      rank: firstRelevantRank(rankDmVoteHCNB, deltaSet) },
        Combined_ER_QE_Vote:                 { rr: reciprocalRank(rankCombinedVote, deltaSet),    rank: firstRelevantRank(rankCombinedVote, deltaSet) },
      },
    });
  }

  // ── Step 4: Aggregate ──
  console.log(`\n[5/5] Aggregating ${results.length} results...`);

  const n = results.length;
  if (n === 0) {
    console.error('No results to aggregate.');
    process.exit(1);
  }

  const mean = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;
  const median = (vals: number[]): number | null => {
    if (vals.length === 0) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  };
  const stdDev = (vals: number[]): number | null => {
    if (vals.length < 2) return null;
    const m = mean(vals);
    return Math.sqrt(mean(vals.map(v => (v - m) ** 2)));
  };
  const meanOrNull = (vals: number[]) => vals.length === 0 ? null : mean(vals);

  const summarize = (key: AlgKey, vsKey: AlgKey): AlgSummary => {
    const mrr = mean(results.map(r => r.metrics[key].rr));
    const ranks = results.map(r => r.metrics[key].rank).filter((v): v is number => v !== null);
    const wins = results.filter(r => r.metrics[key].rr > r.metrics[vsKey].rr).length;
    return { mrr, mean_rank: meanOrNull(ranks), median_rank: median(ranks), rank_std: stdDev(ranks), win_rate: wins / n };
  };

  const algKeys: AlgKey[] = [
    'Top',
    'EvidenceRank_Vote',              'EvidenceRank_Vote_NoBridge',
    'EvidenceRank_Vote_D95',
    'QuadraticEnergy_Vote',           'QuadraticEnergy_Vote_NoBridge',
    'DampedModular_ReferenceBias_NoBridge',
    'DampedModular_Vote_HC_NoBridge',
    'Combined_ER_QE_Vote',
  ];

  // Compare each algorithm against its closest related baseline
  const vsKeyMap: Record<AlgKey, AlgKey> = {
    Top:                                     'EvidenceRank_Vote',
    EvidenceRank_Vote:                       'Top',
    EvidenceRank_Vote_NoBridge:              'EvidenceRank_Vote',
    EvidenceRank_Vote_D95:                   'EvidenceRank_Vote',
    QuadraticEnergy_Vote:                    'EvidenceRank_Vote',
    QuadraticEnergy_Vote_NoBridge:           'QuadraticEnergy_Vote',
    DampedModular_ReferenceBias_NoBridge:    'EvidenceRank_Vote',
    DampedModular_Vote_HC_NoBridge:          'EvidenceRank_Vote',
    Combined_ER_QE_Vote:                     'EvidenceRank_Vote',
  };

  const summaryMap = Object.fromEntries(
    algKeys.map(k => [k, summarize(k, vsKeyMap[k])])
  ) as Record<AlgKey, AlgSummary>;

  const output: BenchmarkOutput = {
    dataset: 'webis-cmv-20',
    generated_at: new Date().toISOString(),
    thread_count: n,
    summary: summaryMap,
    threads: results,
  };

  const fmtRank = (v: number | null) => v === null ? 'N/A' : v.toFixed(1);
  const printAlg = (label: string, s: AlgSummary) => {
    console.log(`\n${label}:`);
    console.log(`  MRR:         ${s.mrr.toFixed(4)}`);
    console.log(`  Mean rank:   ${fmtRank(s.mean_rank)}  ±${fmtRank(s.rank_std)}`);
    console.log(`  Median rank: ${fmtRank(s.median_rank)}`);
    console.log(`  Win rate:    ${(s.win_rate * 100).toFixed(1)}%`);
  };

  console.log('\n=== Benchmark Summary ===');
  console.log(`Threads evaluated: ${n}`);
  for (const key of algKeys) {
    printAlg(key, summaryMap[key]);
  }

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
  await v3Queue.close();
  await graphProcessorQueue.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
