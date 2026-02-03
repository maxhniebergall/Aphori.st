import { getPool, closePool, query } from './pool.js';
import logger from '../logger.js';

async function getLastMigration(): Promise<string | null> {
  const result = await query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY applied_at DESC LIMIT 1'
  );
  return result.rows[0]?.name ?? null;
}

async function rollback(): Promise<void> {
  logger.info('Starting migration rollback...');

  try {
    const lastMigration = await getLastMigration();

    if (!lastMigration) {
      logger.info('No migrations to rollback');
      return;
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      // Note: In a real system, you'd have down migrations
      // For now, just remove the migration record
      logger.warn(`Rolling back ${lastMigration} - manual cleanup may be required`);
      await client.query(
        'DELETE FROM schema_migrations WHERE name = $1',
        [lastMigration]
      );

      await client.query('COMMIT');
      logger.info(`Rolled back migration: ${lastMigration}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Rollback failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  } finally {
    await closePool();
  }
}

// Run if executed directly
rollback();
