import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class TestDatabase {
  private pool: Pool | null = null;
  private adminPool: Pool | null = null;
  private testDbName = 'chitin_test';

  async setup(): Promise<void> {
    // Connect to default postgres database to create test database
    this.adminPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'chitin',
      password: process.env.DB_PASSWORD || 'chitin_dev',
      database: process.env.DB_NAME || 'chitin',
    });

    try {
      // Drop test database if it exists
      await this.adminPool.query(`DROP DATABASE IF EXISTS ${this.testDbName}`);

      // Create fresh test database
      await this.adminPool.query(`CREATE DATABASE ${this.testDbName}`);

      // Create main connection pool
      this.pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'chitin',
        password: process.env.DB_PASSWORD || 'chitin_dev',
        database: this.testDbName,
      });

      // Enable required extensions
      try {
        await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
        await this.pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await this.pool.query('CREATE EXTENSION IF NOT EXISTS ltree');
      } catch (e) {
        console.warn('Some extensions not available, tests may fail', e);
      }

      // Run migrations in order
      await this.runMigrations();
    } catch (error) {
      console.error('Failed to setup test database:', error);
      throw error;
    } finally {
      if (this.adminPool) {
        await this.adminPool.end();
      }
    }
  }

  private async runMigrations(): Promise<void> {
    if (!this.pool) throw new Error('Pool not initialized');

    const migrationsDir = path.resolve(__dirname, '../../db/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        await this.pool.query(sql);
        console.log(`✓ Migration: ${file}`);
      } catch (error) {
        console.error(`✗ Migration failed: ${file}`, error);
        throw error;
      }
    }
  }

  async reset(): Promise<void> {
    if (!this.pool) throw new Error('Pool not initialized');

    // Truncate tables in dependency order (foreign keys)
    const tables = [
      'argument_relations',
      'adu_canonical_map',
      'adu_embeddings',
      'canonical_claim_embeddings',
      'canonical_claims',
      'adus',
      'content_embeddings',
      'votes',
      'replies',
      'posts',
      'agent_tokens',
      'agent_identities',
      'users',
    ];

    for (const table of tables) {
      try {
        await this.pool.query(`TRUNCATE TABLE ${table} CASCADE`);
      } catch (error) {
        // Table may not exist if migrations haven't run
        if ((error as any).code !== '42P01') {
          throw error;
        }
      }
    }
  }

  async teardown(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  getPool(): Pool {
    if (!this.pool) {
      throw new Error('Database not initialized. Call setup() first.');
    }
    return this.pool;
  }
}

export const testDb = new TestDatabase();
