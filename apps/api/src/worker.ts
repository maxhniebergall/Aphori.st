/**
 * Standalone BullMQ worker process.
 * Runs on the DB VM alongside discourse-engine via supervisord.
 * Does NOT start an Express server or validate API-only config (JWT, email, etc.).
 */
import logger from './logger.js';
import { getPool, closePool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { initArgumentService } from './services/argumentService.js';
import { v3Worker } from './jobs/v3Worker.js';
import { closeV3Queue } from './jobs/v3Queue.js';

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Worker received ${signal}, starting graceful shutdown...`);

  try {
    await v3Worker.close();
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

    // Initialize discourse-engine connection (co-located on VM)
    try {
      await initArgumentService();
      logger.info('Worker: discourse-engine connected and ready');
    } catch (error) {
      logger.error('Worker: discourse-engine unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue — worker will retry on job processing
    }

    // Worker starts automatically on import of v3Worker
    logger.info('V3 analysis worker started');
  } catch (error) {
    logger.error('Worker failed to initialize', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Force shutdown after timeout on unhandled cases
setTimeout(() => {}, 2_147_483_647); // Keep process alive

init();
