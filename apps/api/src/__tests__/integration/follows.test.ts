import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TestFactories, createFactories } from '../utils/factories.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool: Pool;
let adminPool: Pool;
let factories: TestFactories;
const TEST_DB = 'chitin_follows_test';

beforeAll(async () => {
  adminPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'chitin',
    password: process.env.DB_PASSWORD || 'chitin_dev',
    database: process.env.DB_NAME || 'chitin',
  });

  await adminPool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid != pg_backend_pid()`
  );
  await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await adminPool.query(`CREATE DATABASE ${TEST_DB}`);

  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'chitin',
    password: process.env.DB_PASSWORD || 'chitin_dev',
    database: TEST_DB,
  });

  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await pool.query('CREATE EXTENSION IF NOT EXISTS ltree');

  // Run all migrations
  const migrationsDir = path.resolve(__dirname, '../../db/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
  }

  factories = createFactories(pool);
}, 30000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid != pg_backend_pid()`
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await adminPool.end();
  }
});

beforeEach(async () => {
  const tables = [
    'follows',
    'notifications',
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
      await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
    } catch (error) {
      if ((error as any).code !== '42P01') throw error;
    }
  }
});

describe('Follows', () => {
  describe('follow/unfollow and counts', () => {
    it('should increment followers_count and following_count on follow', async () => {
      const userA = await factories.createUser({ id: 'alice' });
      const userB = await factories.createUser({ id: 'bob' });

      await factories.createFollow(userA.id, userB.id);

      const followerResult = await pool.query('SELECT followers_count, following_count FROM users WHERE id = $1', [userB.id]);
      expect(followerResult.rows[0].followers_count).toBe(1);
      expect(followerResult.rows[0].following_count).toBe(0);

      const followingResult = await pool.query('SELECT followers_count, following_count FROM users WHERE id = $1', [userA.id]);
      expect(followingResult.rows[0].following_count).toBe(1);
      expect(followingResult.rows[0].followers_count).toBe(0);
    });

    it('should decrement counts on unfollow', async () => {
      const userA = await factories.createUser({ id: 'alice' });
      const userB = await factories.createUser({ id: 'bob' });

      await factories.createFollow(userA.id, userB.id);
      await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [userA.id, userB.id]);

      const followerResult = await pool.query('SELECT followers_count, following_count FROM users WHERE id = $1', [userB.id]);
      expect(followerResult.rows[0].followers_count).toBe(0);

      const followingResult = await pool.query('SELECT followers_count, following_count FROM users WHERE id = $1', [userA.id]);
      expect(followingResult.rows[0].following_count).toBe(0);
    });

    it('should reject self-follow via CHECK constraint', async () => {
      const user = await factories.createUser({ id: 'alice' });

      await expect(
        pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [user.id, user.id])
      ).rejects.toThrow(/no_self_follow/);
    });

    it('should be idempotent (ON CONFLICT DO NOTHING)', async () => {
      const userA = await factories.createUser({ id: 'alice' });
      const userB = await factories.createUser({ id: 'bob' });

      await factories.createFollow(userA.id, userB.id);
      // Second follow should not throw and should not increment counts
      await pool.query(
        'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userA.id, userB.id]
      );

      const result = await pool.query('SELECT followers_count FROM users WHERE id = $1', [userB.id]);
      expect(result.rows[0].followers_count).toBe(1);
    });
  });

  describe('following feed', () => {
    it('should return only posts from followed users', async () => {
      const userA = await factories.createUser({ id: 'alice' });
      const userB = await factories.createUser({ id: 'bob' });
      const userC = await factories.createUser({ id: 'carol' });

      await factories.createPost(userB.id, { title: 'Bob post' });
      await factories.createPost(userC.id, { title: 'Carol post' });

      // Alice follows Bob but not Carol
      await factories.createFollow(userA.id, userB.id);

      const result = await pool.query(
        `SELECT p.*, u.display_name as author_display_name, u.user_type as author_user_type
         FROM posts p
         JOIN users u ON p.author_id = u.id
         WHERE p.deleted_at IS NULL
           AND p.author_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
         ORDER BY p.created_at DESC`,
        [userA.id]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].author_id).toBe(userB.id);
    });

    it('should return empty when following nobody', async () => {
      const userA = await factories.createUser({ id: 'alice' });
      const userB = await factories.createUser({ id: 'bob' });

      await factories.createPost(userB.id, { title: 'Bob post' });

      const result = await pool.query(
        `SELECT p.*
         FROM posts p
         WHERE p.deleted_at IS NULL
           AND p.author_id IN (SELECT following_id FROM follows WHERE follower_id = $1)`,
        [userA.id]
      );

      expect(result.rows.length).toBe(0);
    });
  });

  describe('isFollowing check', () => {
    it('should return true when following', async () => {
      const userA = await factories.createUser({ id: 'alice' });
      const userB = await factories.createUser({ id: 'bob' });

      await factories.createFollow(userA.id, userB.id);

      const result = await pool.query(
        'SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2) AS exists',
        [userA.id, userB.id]
      );
      expect(result.rows[0].exists).toBe(true);
    });

    it('should return false when not following', async () => {
      const userA = await factories.createUser({ id: 'alice' });
      const userB = await factories.createUser({ id: 'bob' });

      const result = await pool.query(
        'SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2) AS exists',
        [userA.id, userB.id]
      );
      expect(result.rows[0].exists).toBe(false);
    });
  });

  describe('pagination', () => {
    it('should paginate followers list', async () => {
      const target = await factories.createUser({ id: 'target' });
      const followers = [];
      for (let i = 0; i < 5; i++) {
        const f = await factories.createUser({ id: `follower_${i}` });
        followers.push(f);
        // Stagger timestamps slightly
        await pool.query(
          `INSERT INTO follows (follower_id, following_id, created_at) VALUES ($1, $2, NOW() - INTERVAL '${5 - i} minutes')`,
          [f.id, target.id]
        );
      }

      // Page 1: limit 2
      const page1 = await pool.query(
        `SELECT u.id, f.created_at FROM follows f
         JOIN users u ON f.follower_id = u.id
         WHERE f.following_id = $1
         ORDER BY f.created_at DESC
         LIMIT 3`,
        [target.id]
      );
      expect(page1.rows.length).toBe(3);

      // Page 2: cursor from last item
      const cursor = page1.rows[2].created_at;
      const page2 = await pool.query(
        `SELECT u.id, f.created_at FROM follows f
         JOIN users u ON f.follower_id = u.id
         WHERE f.following_id = $1 AND f.created_at < $2
         ORDER BY f.created_at DESC
         LIMIT 3`,
        [target.id, cursor]
      );
      expect(page2.rows.length).toBe(2);
    });
  });

  describe('follow notifications', () => {
    it('should create notification for followers when post is created', async () => {
      const author = await factories.createUser({ id: 'author' });
      const follower = await factories.createUser({ id: 'follower' });

      await factories.createFollow(follower.id, author.id);

      // Simulate what the posts route does: create post, then notify followers
      const post = await factories.createPost(author.id, { title: 'New post' });

      // Get follower IDs
      const followersResult = await pool.query(
        'SELECT follower_id FROM follows WHERE following_id = $1',
        [author.id]
      );
      const followerIds = followersResult.rows.map((r: any) => r.follower_id);
      expect(followerIds).toContain(follower.id);

      // Create notification (simulating what the route does)
      for (const fId of followerIds) {
        await pool.query(
          `INSERT INTO notifications (user_id, target_type, target_id, reply_count, last_reply_author_id)
           VALUES ($1, 'post', $2, 1, $3)
           ON CONFLICT (user_id, target_type, target_id)
           DO UPDATE SET reply_count = notifications.reply_count + 1, last_reply_author_id = $3, updated_at = NOW()`,
          [fId, post.id, author.id]
        );
      }

      // Verify notification exists
      const notifResult = await pool.query(
        'SELECT * FROM notifications WHERE user_id = $1 AND target_type = $2 AND target_id = $3',
        [follower.id, 'post', post.id]
      );
      expect(notifResult.rows.length).toBe(1);
      expect(notifResult.rows[0].last_reply_author_id).toBe(author.id);
    });
  });
});
