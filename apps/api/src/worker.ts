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
      RETURNING id, status
    `);
    if (recoveryResult.rowCount && recoveryResult.rowCount > 0) {
      const completed = recoveryResult.rows.filter(r => r.status === 'completed').length;
      const pending = recoveryResult.rows.filter(r => r.status === 'pending').length;
      logger.info(`Worker: reset stale processing runs`, { completed, pending });
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
