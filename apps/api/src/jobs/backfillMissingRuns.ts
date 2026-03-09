#!/usr/bin/env node
/**
 * Backfill missing V3 analysis runs for CMV replies.
 *
 * Groups by thread and enqueues all missing replies for each thread together,
 * so that completed threads have full coverage for accurate benchmark results.
 *
 * Usage:
 *   cd apps/api && npx tsx src/jobs/backfillMissingRuns.ts
 */

import crypto from 'crypto';
import { getPool, closePool } from '../db/pool.js';
import { v3Queue } from './v3Queue.js';
import { enqueueV3Analysis } from './enqueueV3Analysis.js';

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1000;
const MAX_REPLIES_PER_THREAD = 200;

interface MissingReply {
  id: string;
  content: string;
  post_id: string;
  parent_reply_id: string | null;
}

interface ThreadInfo {
  post_id: string;
  title: string;
  total_replies: number;
  missing_replies: number;
}

async function main() {
  const pool = getPool();

  // Wait for Redis connection
  console.log('Waiting for V3 queue to be ready...');
  await v3Queue.waitUntilReady();
  console.log('V3 queue ready.\n');

  // Get per-thread stats: total replies and missing count, ordered by fewest missing first
  // (threads closest to completion get priority)
  console.log(`Querying thread coverage (top ${MAX_REPLIES_PER_THREAD} replies per thread by votes)...`);
  const { rows: threads } = await pool.query<ThreadInfo>(`
    WITH top_replies AS (
      SELECT r.id, r.post_id,
        ROW_NUMBER() OVER (PARTITION BY r.post_id ORDER BY r.score DESC, r.created_at ASC) as rn
      FROM replies r
      JOIN posts p ON p.id = r.post_id
      WHERE p.title LIKE '[cmv:%' AND p.deleted_at IS NULL AND r.deleted_at IS NULL
    ),
    eligible AS (
      SELECT id, post_id FROM top_replies WHERE rn <= $1
    )
    SELECT p.id as post_id, p.title,
      COUNT(e.id)::int as total_replies,
      COUNT(e.id) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM v3_analysis_runs ar
          WHERE ar.source_id = e.id AND ar.source_type = 'reply'
        )
      )::int as missing_replies
    FROM posts p
    JOIN eligible e ON e.post_id = p.id
    WHERE p.title LIKE '[cmv:%' AND p.deleted_at IS NULL
    GROUP BY p.id, p.title
    HAVING COUNT(e.id) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM v3_analysis_runs ar
        WHERE ar.source_id = e.id AND ar.source_type = 'reply'
      )
    ) > 0
    ORDER BY missing_replies ASC
  `, [MAX_REPLIES_PER_THREAD]);

  const totalMissing = threads.reduce((sum, t) => sum + t.missing_replies, 0);
  console.log(`Found ${threads.length} threads with missing replies (${totalMissing} total).\n`);

  if (threads.length === 0) {
    console.log('Nothing to backfill.');
    await cleanup();
    return;
  }

  let enqueued = 0;
  let failed = 0;
  let threadsCompleted = 0;

  for (const thread of threads) {
    // Fetch missing replies among the top N by vote score for this thread
    const { rows: missing } = await pool.query<MissingReply>(`
      WITH top_replies AS (
        SELECT r.id, r.content, r.post_id, r.parent_reply_id
        FROM replies r
        WHERE r.post_id = $1 AND r.deleted_at IS NULL
        ORDER BY r.score DESC, r.created_at ASC
        LIMIT $2
      )
      SELECT tr.id, tr.content, tr.post_id, tr.parent_reply_id
      FROM top_replies tr
      WHERE NOT EXISTS (
        SELECT 1 FROM v3_analysis_runs ar
        WHERE ar.source_id = tr.id AND ar.source_type = 'reply'
      )
      ORDER BY tr.post_id
    `, [thread.post_id, MAX_REPLIES_PER_THREAD]);

    const threadLabel = thread.title.slice(0, 40);
    console.log(`\n  Thread ${threadsCompleted + 1}/${threads.length} ${threadLabel}... (${missing.length}/${thread.total_replies} missing)`);

    // Enqueue in batches within this thread
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batch = missing.slice(i, i + BATCH_SIZE);

      for (const reply of batch) {
        try {
          // Remove any orphaned BullMQ job hash so re-enqueue succeeds
          const contentHash = crypto.createHash('sha256').update(reply.content).digest('hex');
          const jobId = `v3-reply-${reply.id}-${contentHash.substring(0, 8)}`;
          const existingJob = await v3Queue.getJob(jobId);
          if (existingJob) {
            await existingJob.remove();
          }

          // Build parent context
          const parent = reply.parent_reply_id
            ? { sourceType: 'reply' as const, sourceId: reply.parent_reply_id }
            : { sourceType: 'post' as const, sourceId: reply.post_id };

          await enqueueV3Analysis('reply', reply.id, reply.content, parent);
          enqueued++;
        } catch (err) {
          failed++;
          console.error(`    Failed to enqueue reply ${reply.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Throttle between batches
      if (i + BATCH_SIZE < missing.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    threadsCompleted++;
    process.stdout.write(`\r  Progress: ${enqueued} / ${totalMissing} enqueued (${threadsCompleted}/${threads.length} threads, ${failed} failed)`);
  }

  console.log(`\n\nEnqueued ${enqueued} / ${totalMissing} replies (${failed} failed)`);
  console.log(`Threads processed: ${threadsCompleted}`);

  if (failed > 0) {
    console.warn(`\n⚠ ${failed} replies failed to enqueue. Check logs above for details.`);
  }

  await cleanup();
}

async function cleanup() {
  await closePool();
  await v3Queue.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
