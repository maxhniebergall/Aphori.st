/**
 * Reset Contaminated V3 Analysis
 *
 * Deletes v3_analysis_runs for a list of reply IDs (cascading to nodes/edges),
 * then re-enqueues them for fresh analysis. Run this after the Gemini rate
 * limit resets to redo the ~907 replies processed by the wrong model.
 *
 * Usage:
 *   npx tsx src/jobs/resetContaminatedV3.ts \
 *     --ids /tmp/contaminated-reply-ids.txt \
 *     [--batch-size=20] \
 *     [--delay-ms=60000] \
 *     [--dry-run]
 *
 * Rate guidance: the first run hit Gemini's limit at ~2,900 V3 jobs over 67 min
 * (~43/min). With 907 replies and a batch-size=20 / delay-ms=60000, we enqueue
 * at ~20/min, giving the worker a comfortable margin.
 */
import fs from 'fs';
import crypto from 'crypto';
import { getPool, closePool } from '../db/pool.js';
import { enqueueV3Analysis } from './enqueueV3Analysis.js';
import { v3Queue } from './v3Queue.js';
import { logger } from '../logger.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    idsFile: '/tmp/contaminated-reply-ids.txt',
    batchSize: 20,
    delayMs: 60_000,
    dryRun: false,
  };
  for (const arg of args) {
    if (arg.startsWith('--ids='))        opts.idsFile   = arg.split('=')[1]!;
    if (arg.startsWith('--batch-size=')) opts.batchSize = parseInt(arg.split('=')[1]!);
    if (arg.startsWith('--delay-ms='))   opts.delayMs   = parseInt(arg.split('=')[1]!);
    if (arg === '--dry-run')             opts.dryRun    = true;
  }
  return opts;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.idsFile)) {
    console.error(`File not found: ${opts.idsFile}`);
    process.exit(1);
  }

  const replyIds = fs.readFileSync(opts.idsFile, 'utf-8')
    .split('\n').map(l => l.trim()).filter(Boolean);

  console.log(`Loaded ${replyIds.length} contaminated reply IDs`);
  console.log(`batch-size=${opts.batchSize}  delay-ms=${opts.delayMs}  dry-run=${opts.dryRun}\n`);

  const pool = getPool();

  // ── Step 1: Delete contaminated analysis runs ──────────────────────────────
  console.log('[1/2] Deleting contaminated v3_analysis_runs...');
  let deleted = 0;

  // Process deletes in large chunks (no rate concern, just DB)
  const CHUNK = 200;
  for (let i = 0; i < replyIds.length; i += CHUNK) {
    const chunk = replyIds.slice(i, i + CHUNK);
    const placeholders = chunk.map((_, j) => `$${j + 1}`).join(', ');

    if (!opts.dryRun) {
      const result = await pool.query(
        `DELETE FROM v3_analysis_runs
         WHERE source_type = 'reply' AND source_id IN (${placeholders})`,
        chunk
      );
      deleted += result.rowCount ?? 0;
    } else {
      const { rows } = await pool.query(
        `SELECT COUNT(*) FROM v3_analysis_runs
         WHERE source_type = 'reply' AND source_id IN (${placeholders})`,
        chunk
      );
      deleted += parseInt(rows[0].count);
    }
  }

  console.log(`  ${opts.dryRun ? 'Would delete' : 'Deleted'} ${deleted} analysis runs\n`);

  // ── Step 2: Re-enqueue in throttled batches ────────────────────────────────
  console.log('[2/2] Re-enqueueing for fresh analysis...');

  let enqueued = 0;
  let skipped = 0;

  for (let i = 0; i < replyIds.length; i += opts.batchSize) {
    const batch = replyIds.slice(i, i + opts.batchSize);

    // Fetch reply content + parent context for each reply in batch
    const placeholders = batch.map((_, j) => `$${j + 1}`).join(', ');
    const { rows } = await pool.query<{
      id: string;
      content: string;
      post_id: string;
      parent_reply_id: string | null;
    }>(
      `SELECT id, content, post_id, parent_reply_id FROM replies
       WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      batch
    );

    const rowMap = new Map(rows.map(r => [r.id, r]));

    for (const replyId of batch) {
      const row = rowMap.get(replyId);
      if (!row) { skipped++; continue; }

      // Correct parent: reply-to-reply uses parent_reply_id, direct replies use post_id
      const parent = row.parent_reply_id
        ? { sourceType: 'reply' as const, sourceId: row.parent_reply_id }
        : { sourceType: 'post' as const, sourceId: row.post_id };

      if (!opts.dryRun) {
        // BullMQ deduplication: completed jobs with the same jobId are silently
        // no-op'd by queue.add(). Remove the old completed job first so the
        // worker actually re-processes with the correct Gemini model.
        const contentHash = crypto.createHash('sha256').update(row.content).digest('hex');
        const jobId = `v3-reply-${row.id}-${contentHash.substring(0, 8)}`;
        const existingJob = await v3Queue.getJob(jobId);
        if (existingJob) await existingJob.remove();

        await enqueueV3Analysis('reply', row.id, row.content, parent);
      }
      enqueued++;
    }

    const pct = Math.round(((i + batch.length) / replyIds.length) * 100);
    console.log(
      `  Batch ${Math.floor(i / opts.batchSize) + 1}: ` +
      `${opts.dryRun ? 'would enqueue' : 'enqueued'} ${batch.length} replies ` +
      `(${pct}% done, ${skipped} skipped)`
    );

    // Rate-limit: pause between batches (skip after last batch)
    if (!opts.dryRun && i + opts.batchSize < replyIds.length) {
      console.log(`  Waiting ${opts.delayMs / 1000}s before next batch...`);
      await sleep(opts.delayMs);
    }
  }

  console.log(`\nDone. ${enqueued} re-enqueued, ${skipped} skipped (reply deleted/missing).`);
  console.log('After the worker finishes, run the nightly graph processor,');
  console.log('then re-run the benchmark (already-processed threads evaluate instantly).\n');

  await closePool();
}

main().catch(err => {
  logger.error('resetContaminatedV3 failed', err);
  process.exit(1);
});
