/**
 * V3 Backfill Script
 *
 * Re-analyzes existing posts/replies with the V3 neurosymbolic pipeline.
 * Skips content that already has a completed V3 analysis run.
 *
 * Usage:
 *   npx tsx src/jobs/v3Backfill.ts [--batch-size=100] [--delay-ms=500] [--source-type=post|reply|all]
 */
import { getPool, closePool } from '../db/pool.js';
import { enqueueV3Analysis } from './enqueueV3Analysis.js';
import { logger } from '../utils/logger.js';

interface BackfillOptions {
  batchSize: number;
  delayMs: number;
  sourceType: 'post' | 'reply' | 'all';
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const options: BackfillOptions = {
    batchSize: 100,
    delayMs: 500,
    sourceType: 'all',
  };

  for (const arg of args) {
    if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1]!, 10);
    } else if (arg.startsWith('--delay-ms=')) {
      options.delayMs = parseInt(arg.split('=')[1]!, 10);
    } else if (arg.startsWith('--source-type=')) {
      const val = arg.split('=')[1]!;
      if (val === 'post' || val === 'reply' || val === 'all') {
        options.sourceType = val;
      }
    }
  }

  return options;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillSource(
  pool: ReturnType<typeof getPool>,
  sourceType: 'post' | 'reply',
  batchSize: number,
  delayMs: number
): Promise<number> {
  const table = sourceType === 'post' ? 'posts' : 'replies';

  // Find sources with completed V2 analysis but no completed V3 run
  const result = await pool.query(
    `SELECT t.id, t.content
     FROM ${table} t
     WHERE t.analysis_status = 'completed'
       AND t.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM v3_analysis_runs r
         WHERE r.source_type = $1
           AND r.source_id = t.id
           AND r.status = 'completed'
       )
     ORDER BY t.created_at ASC
     LIMIT $2`,
    [sourceType, batchSize]
  );

  let enqueued = 0;
  for (const row of result.rows) {
    await enqueueV3Analysis(sourceType, row.id, row.content);
    enqueued++;

    if (delayMs > 0 && enqueued < result.rows.length) {
      await sleep(delayMs);
    }
  }

  return enqueued;
}

async function main(): Promise<void> {
  const options = parseArgs();
  logger.info('V3 Backfill starting', { ...options });

  const pool = getPool();
  let totalEnqueued = 0;

  try {
    if (options.sourceType === 'all' || options.sourceType === 'post') {
      const count = await backfillSource(pool, 'post', options.batchSize, options.delayMs);
      logger.info(`Enqueued ${count} posts for V3 analysis`);
      totalEnqueued += count;
    }

    if (options.sourceType === 'all' || options.sourceType === 'reply') {
      const count = await backfillSource(pool, 'reply', options.batchSize, options.delayMs);
      logger.info(`Enqueued ${count} replies for V3 analysis`);
      totalEnqueued += count;
    }

    logger.info(`V3 Backfill complete. Total enqueued: ${totalEnqueued}`);
  } catch (error) {
    logger.error('V3 Backfill failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
