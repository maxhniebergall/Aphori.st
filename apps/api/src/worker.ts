/**
 * Standalone BullMQ worker process.
 * Runs on the DB VM alongside discourse-engine via supervisord.
 * Does NOT start an Express server or validate API-only config (JWT, email, etc.).
 */
import logger from './logger.js';
import { getPool, closePool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { initArgumentService } from './services/argumentService.js';
import { createV3Worker } from './jobs/v3Worker.js';
import { closeV3Queue } from './jobs/v3Queue.js';
import { enqueueV3Analysis } from './jobs/enqueueV3Analysis.js';
import type { Worker } from 'bullmq';

// Populated in init() after the discourse engine is confirmed ready.
// Declared here so gracefulShutdown can reference it.
let v3Worker: Worker | null = null;

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Worker received ${signal}, starting graceful shutdown...`);

  try {
    if (v3Worker) {
      await v3Worker.close();
    }
    await closeV3Queue();
    logger.info('Queue and worker closed');
    await closePool();
    logger.info('Database connections closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error closing worker resources', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

async function init(): Promise<void> {
  try {
    // Test database connection
    const pool = getPool();
    await pool.query('SELECT 1');
    logger.info('Worker: database connection established');

    // Run migrations (advisory lock prevents races with API)
    await migrate();

    // Recover stuck 'processing' runs from a previous worker crash.
    // Runs where persistHypergraph committed (i-nodes exist) → mark 'completed' so
    // the UI shows results immediately.  Runs without any i-nodes → reset to
    // 'pending' so they get re-queued for a full retry.
    const recoveryResult = await pool.query(`
      UPDATE v3_analysis_runs r
      SET status = CASE
            WHEN EXISTS (SELECT 1 FROM v3_nodes_i WHERE analysis_run_id = r.id)
              THEN 'completed'
            ELSE 'pending'
          END,
          error_message = CASE
            WHEN EXISTS (SELECT 1 FROM v3_nodes_i WHERE analysis_run_id = r.id)
              THEN 'Recovered by worker restart (concept phase may be incomplete)'
            ELSE 'Reset by worker restart (no data persisted)'
          END
      WHERE status = 'processing'
      RETURNING id, status, source_type, source_id
    `);
    if (recoveryResult.rowCount && recoveryResult.rowCount > 0) {
      const completed = recoveryResult.rows.filter(r => r.status === 'completed').length;
      const pendingRows = recoveryResult.rows.filter(r => r.status === 'pending');
      logger.info(`Worker: reset stale processing runs`, { completed, pending: pendingRows.length });

      // Re-enqueue BullMQ jobs for runs reset to 'pending'. The original BullMQ
      // jobs were silently marked "completed" (worker skipped without error), so
      // they're gone from Redis — nothing would trigger re-analysis without this.
      if (pendingRows.length > 0) {
        const [postRows, replyRows] = await Promise.all([
          pool.query(
            `SELECT id, content FROM posts WHERE id = ANY($1) AND deleted_at IS NULL`,
            [pendingRows.filter(r => r.source_type === 'post').map(r => r.source_id)]
          ),
          pool.query(
            `SELECT id, content FROM replies WHERE id = ANY($1) AND deleted_at IS NULL`,
            [pendingRows.filter(r => r.source_type === 'reply').map(r => r.source_id)]
          ),
        ]);
        const postContent = new Map(postRows.rows.map(r => [r.id, r.content]));
        const replyContent = new Map(replyRows.rows.map(r => [r.id, r.content]));

        let requeued = 0;
        for (const run of pendingRows) {
          const content = run.source_type === 'post'
            ? postContent.get(run.source_id)
            : replyContent.get(run.source_id);
          if (!content) {
            logger.warn(`Worker: recovery could not find content for ${run.source_type} ${run.source_id}, skipping re-enqueue`);
            continue;
          }
          try {
            await enqueueV3Analysis(run.source_type, run.source_id, content);
            requeued++;
          } catch (err) {
            logger.error(`Worker: recovery failed to re-enqueue ${run.source_type} ${run.source_id}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        logger.info(`Worker: re-enqueued ${requeued}/${pendingRows.length} recovered runs`);
      }
    }

    // Wait for discourse engine to be ready before starting the BullMQ worker.
    // If the DE isn't up after all retries, exit so supervisord can restart us —
    // jobs will stay safely queued in Redis until the DE comes up.
    await initArgumentService();
    logger.info('Worker: discourse-engine connected and ready');

    // Create the worker now that the DE is confirmed ready.
    // This prevents a burst of "fetch failed" errors from jobs that get picked
    // up and immediately attempt to call an unavailable discourse engine.
    v3Worker = createV3Worker();

    v3Worker.on('error', (err) => {
      logger.error('V3 worker fatal error, exiting', { error: err instanceof Error ? err.message : String(err) });
      gracefulShutdown('worker-error').catch(() => process.exit(1));
    });

    v3Worker.on('closed', () => {
      logger.warn('V3 worker closed unexpectedly, exiting');
      process.exit(1);
    });

    logger.info('V3 analysis worker started');
  } catch (error) {
    logger.error('Worker failed to initialize', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

init();
