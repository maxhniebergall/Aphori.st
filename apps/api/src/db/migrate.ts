import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, closePool, query } from './pool.js';
import logger from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

interface Migration {
  name: string;
  content: string;
}

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(result.rows.map(r => r.name));
}

async function getMigrationFiles(): Promise<Migration[]> {
  const files = await fs.readdir(MIGRATIONS_DIR);
  const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

  const migrations: Migration[] = [];
  for (const file of sqlFiles) {
    const content = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');
    migrations.push({ name: file, content });
  }

  return migrations;
}

async function applyMigration(migration: Migration): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Run the migration
    await client.query(migration.content);

    // Record the migration
    await client.query(
      'INSERT INTO schema_migrations (name) VALUES ($1)',
      [migration.name]
    );

    await client.query('COMMIT');
    logger.info(`Applied migration: ${migration.name}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Advisory lock key for migration coordination (arbitrary fixed int)
const MIGRATION_LOCK_ID = 839271;

export async function migrate(): Promise<void> {
  logger.info('Starting database migrations...');

  const client = await getPool().connect();
  try {
    // Acquire advisory lock to prevent concurrent migrations
    const lockResult = await client.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1)',
      [MIGRATION_LOCK_ID]
    );

    if (!lockResult.rows[0]?.pg_try_advisory_lock) {
      logger.info('Another instance is running migrations, skipping');
      return;
    }

    try {
      await ensureMigrationsTable();
      const applied = await getAppliedMigrations();
      const migrations = await getMigrationFiles();

      let appliedCount = 0;
      for (const migration of migrations) {
        if (!applied.has(migration.name)) {
          await applyMigration(migration);
          appliedCount++;
        }
      }

      if (appliedCount === 0) {
        logger.info('No new migrations to apply');
      } else {
        logger.info(`Applied ${appliedCount} migration(s)`);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    }
  } finally {
    client.release();
  }
}

// Run if executed directly (for standalone migration job)
const isDirectRun = process.argv[1]?.endsWith('migrate.js');
if (isDirectRun) {
  migrate()
    .catch((error) => {
      logger.error('Migration failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    })
    .finally(() => closePool());
}
