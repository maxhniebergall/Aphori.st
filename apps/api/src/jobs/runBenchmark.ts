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
import { initPool, computeInWorker, destroyPool } from './benchmarkWorkerPool.js';

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
    'eval-only': { type: 'boolean', default: false },
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
const evalOnly   = args['eval-only'] as boolean;

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

/** Mean rank across ALL delta replies (not just the best one). */
function meanDeltaRank(results: RankedNode[], deltaIds: Set<string>): number | null {
  const ranks: number[] = [];
  for (const r of results) {
    if (deltaIds.has(r.id)) ranks.push(r.rank);
  }
  return ranks.length === 0 ? null : ranks.reduce((a, b) => a + b, 0) / ranks.length;
}

// ── Output schema ─────────────────────────────────────────────────────────

type AlgMetrics = { rr: number; rank: number | null; mean_delta_rank: number | null };
type AlgSummary = {
  mrr: number; mrr_std: number | null;
  mean_rank: number | null; median_rank: number | null; rank_std: number | null;
  mean_delta_rank: number | null; mean_delta_rank_std: number | null;
  win_rate: number;
  wilcoxon_w: number | null; wilcoxon_p: number | null; wilcoxon_n: number | null;
  bootstrap_p: number | null; bootstrap_ci_lo: number | null; bootstrap_ci_hi: number | null;
};

type AlgKey =
  | 'Top_Flat'
  | 'EvidenceRank_Vote'
  | 'EvidenceRank_Vote_NoBridge'
  | 'EvidenceRank_Vote_D95'
  | 'QuadraticEnergy_Vote'
  | 'QuadraticEnergy_Vote_NoBridge'
  | 'DampedModular_ReferenceBias_NoBridge'
  | 'DampedModular_Vote_HC_NoBridge'
  | 'Combined_ER_QE_Vote'
  | 'EvidenceRank_Enthymeme_Inherit' | 'EvidenceRank_Enthymeme_Attack' | 'EvidenceRank_Enthymeme_Support'
  | 'EvidenceRank_Enthymeme_Inherit_Bridge' | 'EvidenceRank_Enthymeme_Attack_Bridge' | 'EvidenceRank_Enthymeme_Support_Bridge'
  | 'ER_Enth_Inherit_W10' | 'ER_Enth_Attack_W10' | 'ER_Enth_Support_W10'
  | 'ER_Enth_Inherit_WPct' | 'ER_Enth_Attack_WPct' | 'ER_Enth_Support_WPct'
  | 'ER_Enth_Inherit_WPctConf' | 'ER_Enth_Attack_WPctConf' | 'ER_Enth_Support_WPctConf'
  | 'ER_Vote_Sum' | 'ER_Vote_Sum_NoDC' | 'ER_Vote_NoDC' | 'ER_Vote_Dim_NoDC'
  | 'ER_Vote_Sum_NoDC_Bridge' | 'ER_Vote_Geo_NoDC' | 'ER_Vote_D95_Sum_NoDC'
  | 'RRF_ER_QE_Vote' | 'RRF_ER_QE_Reply'
  | 'Top_ReplyCount' | 'RRF_Top_Vote_ReplyCount';

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

  // Ensure Redis is connected before any enqueue calls
  if (!evalOnly) {
    await v3Queue.waitUntilReady();
  }

  let enqueueFailures = 0;

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
    } else if (evalOnly) {
      console.warn(`Skipping thread ${thread.threadId}: not yet ingested (eval-only mode)`);
      continue;
    } else {
      try {
        const post = await PostRepo.create(DEV_USER_ID, { title, content: opText });
        postId = post.id;
        newPostIds.push(postId);
        try {
          await enqueueV3Analysis('post', postId, opText);
        } catch (err) {
          enqueueFailures++;
          console.error(`  Enqueue failed for post ${postId}: ${err instanceof Error ? err.message : String(err)}`);
        }
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

      if (reanalyze && !evalOnly) {
        // Delete existing analysis runs and BullMQ jobs so the new engine re-processes them
        await pool.query(
          `DELETE FROM v3_analysis_runs WHERE source_type = $1 AND source_id = $2`,
          ['post', postId]
        );
        await removeBullMQJob('post', postId, opText);
        try {
          await enqueueV3Analysis('post', postId, opText);
        } catch (err) {
          enqueueFailures++;
          console.error(`  Enqueue failed for post ${postId} (reanalyze): ${err instanceof Error ? err.message : String(err)}`);
        }

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
          try {
            await enqueueV3Analysis('reply', replyId, node.text, replyParent);
          } catch (err) {
            enqueueFailures++;
            console.error(`  Enqueue failed for reply ${replyId} (reanalyze): ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        console.log(`    [reanalyze] Deleted runs+jobs and re-enqueued post + ${cmvToReply.size - 1} replies`);
      }
    } else if (!evalOnly) {
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
            try {
              await enqueueV3Analysis('reply', reply.id, node.text, replyParent);
            } catch (err) {
              enqueueFailures++;
              console.error(`  Enqueue failed for reply ${reply.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
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
    if (!dryRun && !evalOnly && newPostIds.length > 0) {
      console.log(`  Waiting for V3 analysis on ${newPostIds.length} new threads...`);
      await pollUntilComplete(newPostIds, apiBase);
      console.log(`  Batch ${batchLabel} done.\n`);
    }
  } // end batch loop

  const ingestedPostIds = [...mapping.values()].map(m => m.post_id);
  console.log(`Ingested ${ingestedPostIds.length} threads`);
  if (enqueueFailures > 0) {
    console.warn(`\n⚠ ${enqueueFailures} enqueue failures occurred during ingestion. Some replies may not be analyzed.`);
  }

  if (ingestedPostIds.length === 0) {
    console.error('Nothing to evaluate.');
    process.exit(1);
  }

  // ── Step 2: Poll (catch-up for already-ingested threads) ──
  if (evalOnly) {
    // Filter to only fully-covered threads (all top-200 eligible replies have analysis runs)
    console.log('\n[2/5] Filtering to fully-covered threads...');
    const pool = getPool();
    const { rows: coveredRows } = await pool.query<{ post_id: string }>(`
      WITH top_replies AS (
        SELECT r.id, r.post_id,
          ROW_NUMBER() OVER (PARTITION BY r.post_id ORDER BY r.score DESC, r.created_at ASC) as rn
        FROM replies r
        JOIN posts p ON p.id = r.post_id
        WHERE p.title LIKE '[cmv:%' AND p.deleted_at IS NULL AND r.deleted_at IS NULL
      ),
      eligible AS (
        SELECT id, post_id FROM top_replies WHERE rn <= 200
      ),
      thread_stats AS (
        SELECT post_id,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM v3_analysis_runs ar WHERE ar.source_id = eligible.id AND ar.source_type = 'reply'
          )) as done
        FROM eligible GROUP BY post_id
      )
      SELECT post_id FROM thread_stats WHERE done = total
    `);
    const coveredPostIds = new Set(coveredRows.map(r => r.post_id));
    const beforeCount = mapping.size;
    for (const [threadId, info] of mapping) {
      if (!coveredPostIds.has(info.post_id)) {
        mapping.delete(threadId);
      }
    }
    console.log(`  ${coveredPostIds.size} threads fully covered, ${beforeCount - mapping.size} filtered out, ${mapping.size} remaining`);
  } else if (!dryRun) {
    console.log('\n[2/5] Waiting for V3 analysis to complete (already-ingested threads)...');
    await pollUntilComplete(ingestedPostIds, apiBase);
  } else {
    console.log('\n[2/5] Dry run: skipping poll');
  }

  // ── Step 2.5: Run nightly graph processor (EvidenceRank + IBA) ──
  // Skipped in eval-only mode: benchmark route computes its own rankings
  // from getThreadGraph(), independent of the nightly processor's ER/karma values.
  if (!dryRun && !evalOnly) {
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
  } else if (evalOnly) {
    console.log('\n[3/5] Skipping graph processor (eval-only: benchmark computes rankings independently)');
  } else {
    console.log('\n[3/5] Dry run: skipping graph processor');
  }

  // ── Step 4: Evaluate ──
  // Phase A: Fetch graph data from API (lightweight DB queries only, no computation)
  // Phase B: Compute rankings in worker thread pool (4 threads, true parallelism)
  console.log('\n[4/5] Fetching graph data + computing rankings (4 worker threads)...');
  const results: ThreadResult[] = [];

  const evalEntries = [...mapping.entries()];

  type GraphOnlyResult = {
    threadId: string;
    info: (typeof evalEntries)[0][1];
    data: {
      post_id: string;
      parent_argument: string;
      top_tree?: { items: unknown[] };
      graph?: {
        nodes: Array<{ id: string; text: string; vote_score: number; source_id: string; source_type: 'post' | 'reply' }>;
        edges: Array<{ from_node_id: string; to_node_id: string; direction: 'SUPPORT' | 'ATTACK'; confidence: number }>;
        nodeTargets: Array<[string, string[]]>;
      };
      enthymemes?: Array<{
        id: string; content: string; probability: number;
        scheme_direction: 'SUPPORT' | 'ATTACK';
        source_type: 'post' | 'reply'; source_id: string;
        conclusion_node_id: string | null;
      }>;
      enthymeme_count?: number;
      replyChildCounts?: Array<[string, number]>;
    };
  };

  // Phase A: Fetch graph data in batches of 20 (lightweight I/O)
  console.log('  Phase A: Fetching graph data from API...');
  const graphDataResults: (GraphOnlyResult | null)[] = [];
  const FETCH_BATCH = 4;
  for (let i = 0; i < evalEntries.length; i += FETCH_BATCH) {
    const batch = evalEntries.slice(i, i + FETCH_BATCH);
    const batchResults = await Promise.all(
      batch.map(async ([threadId, info]) => {
        if (info.delta_reply_ids.length === 0) {
          console.warn(`  Skipping thread ${threadId}: no delta replies mapped`);
          return null;
        }
        try {
          const resp = await undiciFetch(`${apiBase}/api/benchmark/thread/${info.post_id}?graph_only=1`, {
            headers: { Authorization: 'Bearer dev_token' },
            dispatcher: benchmarkAgent,
          });
          if (!resp.ok) {
            console.warn(`  Skipping thread ${threadId}: API returned ${resp.status}`);
            return null;
          }
          return { threadId, info, data: await resp.json() as GraphOnlyResult['data'] };
        } catch (err) {
          console.warn(`  Skipping thread ${threadId}: fetch failed (${err instanceof Error ? err.message : String(err)})`);
          return null;
        }
      })
    );
    graphDataResults.push(...batchResults);
    if (i + FETCH_BATCH < evalEntries.length) await new Promise(r => setTimeout(r, 200));
  }

  const validGraphData = graphDataResults.filter((r): r is GraphOnlyResult =>
    r !== null && r.data.graph != null && r.data.graph.nodes.length > 0
  );
  console.log(`  Fetched ${validGraphData.length}/${evalEntries.length} thread graphs`);

  // Filter graph data to only include pre-delta replies.
  // The CMV loader already filters post-delta comments from thread.nodes, so
  // cmvToReply only contains pre-delta reply mappings. For eval-only (where
  // post-delta replies exist in DB), we need to strip them from the API response.
  for (const gd of validGraphData) {
    const validSourceIds = new Set<string>();
    validSourceIds.add(gd.info.post_id);
    for (const dbId of gd.info.cmv_to_reply.values()) {
      validSourceIds.add(dbId);
    }

    const origNodeCount = gd.data.graph!.nodes.length;
    gd.data.graph!.nodes = gd.data.graph!.nodes.filter(
      n => validSourceIds.has(n.source_id)
    );
    const keptNodeIds = new Set(gd.data.graph!.nodes.map(n => n.id));
    gd.data.graph!.edges = gd.data.graph!.edges.filter(
      e => keptNodeIds.has(e.from_node_id) && keptNodeIds.has(e.to_node_id)
    );
    gd.data.graph!.nodeTargets = gd.data.graph!.nodeTargets.filter(
      ([nodeId]) => keptNodeIds.has(nodeId)
    );
    if (gd.data.enthymemes) {
      gd.data.enthymemes = gd.data.enthymemes.filter(
        e => validSourceIds.has(e.source_id)
      );
    }
    const filtered = origNodeCount - gd.data.graph!.nodes.length;
    if (filtered > 0) {
      console.log(`    ${gd.threadId}: filtered ${filtered} post-delta i-nodes`);
    }
  }

  // Phase B: Compute rankings in worker pool (4 threads)
  console.log('  Phase B: Computing rankings in 4 worker threads...');
  initPool(4);

  try {
    const COMPUTE_BATCH = 4;
    const totalBatches = Math.ceil(validGraphData.length / COMPUTE_BATCH);
    for (let i = 0; i < validGraphData.length; i += COMPUTE_BATCH) {
      const batch = validGraphData.slice(i, i + COMPUTE_BATCH);
      const batchNum = Math.floor(i / COMPUTE_BATCH) + 1;
      console.log(`  Compute batch ${batchNum}/${totalBatches} (threads ${i + 1}–${Math.min(i + COMPUTE_BATCH, validGraphData.length)})...`);

      await Promise.all(
        batch.map(async ({ threadId, info, data }) => {
          try {
            const computeResult = await computeInWorker({
              threadGraph: data.graph!,
              validEnthymemes: data.enthymemes ?? [],
              treeItems: [],
              replyChildCounts: data.replyChildCounts ?? [],
            });

            const deltaSet = new Set(info.delta_reply_ids);

            const algs = {
              Top_Flat:                            computeResult.algTop,
              EvidenceRank_Vote:                   computeResult.erVote,
              EvidenceRank_Vote_NoBridge:          computeResult.erVoteNB,
              EvidenceRank_Vote_D95:               computeResult.erVote95,
              QuadraticEnergy_Vote:                computeResult.qeVote,
              QuadraticEnergy_Vote_NoBridge:       computeResult.qeVoteNB,
              DampedModular_ReferenceBias_NoBridge:      computeResult.dmRefBiasNB,
              DampedModular_Vote_HC_NoBridge:            computeResult.dmVoteHCNB,
              Combined_ER_QE_Vote:                 computeResult.combinedVote,
              EvidenceRank_Enthymeme_Inherit:      computeResult.erEnthInherit,
              EvidenceRank_Enthymeme_Attack:       computeResult.erEnthAttack,
              EvidenceRank_Enthymeme_Support:      computeResult.erEnthSupport,
              EvidenceRank_Enthymeme_Inherit_Bridge: computeResult.erEnthInheritBridge,
              EvidenceRank_Enthymeme_Attack_Bridge:   computeResult.erEnthAttackBridge,
              EvidenceRank_Enthymeme_Support_Bridge:  computeResult.erEnthSupportBridge,
              ER_Enth_Inherit_W10:      computeResult.erEnthInheritW10,
              ER_Enth_Attack_W10:       computeResult.erEnthAttackW10,
              ER_Enth_Support_W10:      computeResult.erEnthSupportW10,
              ER_Enth_Inherit_WPct:     computeResult.erEnthInheritWPct,
              ER_Enth_Attack_WPct:      computeResult.erEnthAttackWPct,
              ER_Enth_Support_WPct:     computeResult.erEnthSupportWPct,
              ER_Enth_Inherit_WPctConf: computeResult.erEnthInheritWPctConf,
              ER_Enth_Attack_WPctConf:  computeResult.erEnthAttackWPctConf,
              ER_Enth_Support_WPctConf: computeResult.erEnthSupportWPctConf,
              ER_Vote_Sum:              computeResult.erVoteSum,
              ER_Vote_Sum_NoDC:         computeResult.erVoteSumNoDC,
              ER_Vote_NoDC:             computeResult.erVoteNoDC,
              ER_Vote_Dim_NoDC:         computeResult.erVoteDimNoDC,
              ER_Vote_Sum_NoDC_Bridge:  computeResult.erVoteSumNoDCBridge,
              ER_Vote_Geo_NoDC:         computeResult.erVoteGeoNoDC,
              ER_Vote_D95_Sum_NoDC:     computeResult.erVoteD95SumNoDC,
              RRF_ER_QE_Vote:           computeResult.rrfErQeVote,
              RRF_ER_QE_Reply:          computeResult.rrfErQeReply,
              Top_ReplyCount:           computeResult.topReplyCount,
              RRF_Top_Vote_ReplyCount:  computeResult.rrfTopVoteReplyCount,
            };

            const metrics: Record<string, AlgMetrics> = {};
            for (const [key, ranked] of Object.entries(algs)) {
              metrics[key] = {
                rr: reciprocalRank(ranked, deltaSet),
                rank: firstRelevantRank(ranked, deltaSet),
                mean_delta_rank: meanDeltaRank(ranked, deltaSet),
              };
            }

            results.push({
              test_id: `cmv_thread_${threadId}`,
              parent_argument: data.parent_argument,
              delta_reply_ids: info.delta_reply_ids,
              algorithms: algs,
              metrics: metrics as ThreadResult['metrics'],
            });
          } catch (err) {
            console.warn(`  Worker failed for thread ${threadId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        })
      );
    }
  } finally {
    await destroyPool();
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

  // ── Wilcoxon signed-rank test (two-sided, normal approximation) ──
  // Standard normal CDF via Abramowitz & Stegun rational approximation
  function normalCDF(x: number): number {
    if (x < -8) return 0;
    if (x > 8) return 1;
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const t = 1 / (1 + p * Math.abs(x) / Math.SQRT2);
    const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
    return 0.5 * (1 + sign * erf);
  }

  function wilcoxonSignedRank(
    algRRs: number[],
    baseRRs: number[]
  ): { w: number; p: number; n: number } | null {
    // Compute paired differences, drop zeros
    const diffs: number[] = [];
    for (let i = 0; i < algRRs.length; i++) {
      const d = algRRs[i]! - baseRRs[i]!;
      if (d !== 0) diffs.push(d);
    }
    const nNonZero = diffs.length;
    if (nNonZero < 10) return null; // too few non-ties for meaningful test

    // Rank absolute values (average ranks for ties)
    const indexed = diffs.map((d, i) => ({ abs: Math.abs(d), sign: Math.sign(d), idx: i }));
    indexed.sort((a, b) => a.abs - b.abs);

    const ranks = new Array<number>(nNonZero);
    let i = 0;
    while (i < nNonZero) {
      let j = i;
      while (j < nNonZero && indexed[j]!.abs === indexed[i]!.abs) j++;
      const avgRank = (i + 1 + j) / 2; // 1-based average rank
      for (let k = i; k < j; k++) ranks[indexed[k]!.idx] = avgRank;
      i = j;
    }

    // Sum positive and negative ranks
    let wPlus = 0, wMinus = 0;
    for (let k = 0; k < nNonZero; k++) {
      if (diffs[k]! > 0) wPlus += ranks[k]!;
      else wMinus += ranks[k]!;
    }
    const w = Math.min(wPlus, wMinus);

    // Normal approximation with continuity correction
    // Tie correction for variance: subtract sum_t (t^3 - t) / 48 for each group of t ties
    const mu = nNonZero * (nNonZero + 1) / 4;
    let variance = nNonZero * (nNonZero + 1) * (2 * nNonZero + 1) / 24;
    // Tie correction
    i = 0;
    const sortedAbs = indexed.map(x => x.abs);
    let ti = 0;
    while (ti < nNonZero) {
      let tj = ti;
      while (tj < nNonZero && sortedAbs[tj] === sortedAbs[ti]) tj++;
      const tieSize = tj - ti;
      if (tieSize > 1) variance -= (tieSize ** 3 - tieSize) / 48;
      ti = tj;
    }

    const sigma = Math.sqrt(variance);
    const z = (Math.abs(w - mu) - 0.5) / sigma; // continuity correction
    const p = 2 * normalCDF(-z); // two-sided

    return { w, p, n: nNonZero };
  }

  // ── Paired bootstrap test (two-sided, 10k resamples) ──
  // Returns p-value and 95% CI for the mean RR difference (alg - base).
  function pairedBootstrap(
    algRRs: number[],
    baseRRs: number[],
    nBoot = 10_000
  ): { p: number; ciLo: number; ciHi: number } | null {
    const n = algRRs.length;
    if (n < 10) return null;

    const diffs = algRRs.map((v, i) => v - (baseRRs[i] ?? 0));
    const observed = diffs.reduce((a, b) => a + b, 0) / n;

    // Center differences under H0 (mean diff = 0) for p-value computation
    const centered = diffs.map(d => d - observed);

    // Seeded pseudo-random for reproducibility (simple xorshift32)
    let seed = 42;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    };

    // Bootstrap from centered diffs (for p-value) and raw diffs (for CI)
    const bootMeansH0: number[] = [];
    const bootMeansCI: number[] = [];
    for (let b = 0; b < nBoot; b++) {
      let sumH0 = 0, sumCI = 0;
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(rand() * n);
        sumH0 += centered[idx] ?? 0;
        sumCI += diffs[idx] ?? 0;
      }
      bootMeansH0.push(sumH0 / n);
      bootMeansCI.push(sumCI / n);
    }

    // Two-sided p-value: proportion of H0 bootstrap samples as extreme as observed
    const countExtreme = bootMeansH0.filter(m => Math.abs(m) >= Math.abs(observed)).length;
    const p = Math.max(countExtreme / nBoot, 1 / nBoot); // floor at 1/nBoot

    // 95% CI (percentile method from raw diffs)
    bootMeansCI.sort((a, b) => a - b);
    const lo = bootMeansCI[Math.floor(0.025 * nBoot)] ?? 0;
    const hi = bootMeansCI[Math.floor(0.975 * nBoot)] ?? 0;

    return { p, ciLo: lo, ciHi: hi };
  }

  // win_rate = fraction of threads where this algorithm beats the Top baseline.
  // Using a consistent baseline makes win_rates comparable across algorithms.
  const baselineRRs = results.map(r => r.metrics['Top_Flat'].rr);

  const summarize = (key: AlgKey): AlgSummary => {
    const rrs = results.map(r => r.metrics[key].rr);
    const mrr = mean(rrs);
    const ranks = results.map(r => r.metrics[key].rank).filter((v): v is number => v !== null);
    const mdr = results.map(r => r.metrics[key].mean_delta_rank).filter((v): v is number => v !== null);
    const wins = results.filter(r => r.metrics[key].rr > r.metrics['Top_Flat'].rr).length;
    const wilcoxon = key === 'Top_Flat' ? null : wilcoxonSignedRank(rrs, baselineRRs);
    const bootstrap = key === 'Top_Flat' ? null : pairedBootstrap(rrs, baselineRRs);
    return {
      mrr, mrr_std: stdDev(rrs), mean_rank: meanOrNull(ranks), median_rank: median(ranks), rank_std: stdDev(ranks),
      mean_delta_rank: meanOrNull(mdr), mean_delta_rank_std: stdDev(mdr),
      win_rate: wins / n,
      wilcoxon_w: wilcoxon?.w ?? null, wilcoxon_p: wilcoxon?.p ?? null, wilcoxon_n: wilcoxon?.n ?? null,
      bootstrap_p: bootstrap?.p ?? null,
      bootstrap_ci_lo: bootstrap?.ciLo ?? null,
      bootstrap_ci_hi: bootstrap?.ciHi ?? null,
    };
  };

  const algKeys: AlgKey[] = [
    'Top_Flat',
    'EvidenceRank_Vote',
    'EvidenceRank_Vote_NoBridge',
    'EvidenceRank_Vote_D95',
    'QuadraticEnergy_Vote',
    'QuadraticEnergy_Vote_NoBridge',
    'DampedModular_ReferenceBias_NoBridge',
    'DampedModular_Vote_HC_NoBridge',
    'Combined_ER_QE_Vote',
    'EvidenceRank_Enthymeme_Inherit', 'EvidenceRank_Enthymeme_Attack', 'EvidenceRank_Enthymeme_Support',
    'EvidenceRank_Enthymeme_Inherit_Bridge', 'EvidenceRank_Enthymeme_Attack_Bridge', 'EvidenceRank_Enthymeme_Support_Bridge',
    'ER_Enth_Inherit_W10', 'ER_Enth_Attack_W10', 'ER_Enth_Support_W10',
    'ER_Enth_Inherit_WPct', 'ER_Enth_Attack_WPct', 'ER_Enth_Support_WPct',
    'ER_Enth_Inherit_WPctConf', 'ER_Enth_Attack_WPctConf', 'ER_Enth_Support_WPctConf',
    'ER_Vote_Sum', 'ER_Vote_Sum_NoDC', 'ER_Vote_NoDC', 'ER_Vote_Dim_NoDC',
    'ER_Vote_Sum_NoDC_Bridge', 'ER_Vote_Geo_NoDC', 'ER_Vote_D95_Sum_NoDC',
    'RRF_ER_QE_Vote', 'RRF_ER_QE_Reply',
    'Top_ReplyCount', 'RRF_Top_Vote_ReplyCount',
  ];

  const summaryMap = Object.fromEntries(
    algKeys.map(k => [k, summarize(k)])
  ) as Record<AlgKey, AlgSummary>;

  const output: BenchmarkOutput = {
    dataset: 'webis-cmv-20',
    generated_at: new Date().toISOString(),
    thread_count: n,
    summary: summaryMap,
    threads: results,
  };

  const fmtRank = (v: number | null) => v === null ? 'N/A' : v.toFixed(1);
  const fmtP = (p: number | null) => {
    if (p === null) return 'N/A';
    if (p < 0.001) return p.toExponential(2);
    return p.toFixed(4);
  };
  const sigLabel = (p: number | null) => {
    if (p === null) return '';
    if (p < 0.001) return ' ***';
    if (p < 0.01) return ' **';
    if (p < 0.05) return ' *';
    return ' (ns)';
  };
  const printAlg = (label: string, s: AlgSummary) => {
    console.log(`\n${label}:`);
    console.log(`  MRR:         ${s.mrr.toFixed(4)}  ±${s.mrr_std !== null ? s.mrr_std.toFixed(4) : 'N/A'}`);
    console.log(`  Mean rank:   ${fmtRank(s.mean_rank)}  ±${fmtRank(s.rank_std)}`);
    console.log(`  Median rank: ${fmtRank(s.median_rank)}`);
    console.log(`  MR (all Δ):  ${fmtRank(s.mean_delta_rank)}  ±${fmtRank(s.mean_delta_rank_std)}`);
    console.log(`  Win rate:    ${(s.win_rate * 100).toFixed(1)}%`);
    if (s.wilcoxon_p !== null) {
      console.log(`  Wilcoxon:    W=${s.wilcoxon_w}, p=${fmtP(s.wilcoxon_p)}${sigLabel(s.wilcoxon_p)} (n=${s.wilcoxon_n} non-ties vs Top_Flat)`);
    }
    if (s.bootstrap_p !== null) {
      console.log(`  Bootstrap:   p=${fmtP(s.bootstrap_p)}${sigLabel(s.bootstrap_p)}, ΔMRR 95% CI [${s.bootstrap_ci_lo!.toFixed(4)}, ${s.bootstrap_ci_hi!.toFixed(4)}] vs Top_Flat`);
    }
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
  if (!evalOnly) await v3Queue.close();
  await graphProcessorQueue.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
