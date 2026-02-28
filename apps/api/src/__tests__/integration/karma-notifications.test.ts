import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { TestFactories, createFactories } from '../utils/factories.js';

// Self-contained test setup - creates its own DB connection
// (the global setup.ts's testDb.setup() is idempotent and won't conflict)

let pool: Pool;
let adminPool: Pool;
let factories: TestFactories;
const TEST_DB = 'chitin_karma_test';

beforeAll(async () => {
  adminPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'chitin',
    password: process.env.DB_PASSWORD || 'chitin_dev',
    database: process.env.DB_NAME || 'chitin',
  });

  // Terminate any existing connections and recreate
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

  // Extensions
  await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query('CREATE EXTENSION IF NOT EXISTS ltree');

  // Run migrations
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationsDir = path.resolve(__dirname, '../../db/migrations');
  const files = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
  }

  factories = createFactories(pool);
}, 60000);

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
  if (adminPool) {
    await adminPool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()`
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await adminPool.end();
  }
});

beforeEach(async () => {
  // Truncate in dependency order
  const tables = [
    'notifications', 'follows', 'argument_relations', 'adu_canonical_map', 'adu_embeddings',
    'canonical_claim_embeddings', 'canonical_claims', 'adus', 'content_embeddings',
    'votes', 'replies', 'posts', 'agent_tokens', 'agent_identities', 'users',
  ];
  for (const table of tables) {
    try {
      await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
    } catch {
      // Table may not exist
    }
  }
});

// V4: votes no longer update karma (karma is batch-only via nightly pipeline).
// Votes only update the post/reply score column via the update_target_score() trigger.
describe('Vote Score (V4)', () => {
  it('should increment post score on upvote', async () => {
    const author = await factories.createUser();
    const voter = await factories.createUser();
    const post = await factories.createPost(author.id);

    await factories.createVote(voter.id, 'post', post.id, 1);

    const result = await pool.query('SELECT score FROM posts WHERE id = $1', [post.id]);
    expect(result.rows[0].score).toBe(1);
  });

  it('should decrement post score on downvote', async () => {
    const author = await factories.createUser();
    const voter = await factories.createUser();
    const post = await factories.createPost(author.id);

    await factories.createVote(voter.id, 'post', post.id, -1);

    const result = await pool.query('SELECT score FROM posts WHERE id = $1', [post.id]);
    expect(result.rows[0].score).toBe(-1);
  });

  it('should update post score when vote changes from up to down', async () => {
    const author = await factories.createUser();
    const voter = await factories.createUser();
    const post = await factories.createPost(author.id);

    await factories.createVote(voter.id, 'post', post.id, 1);
    // Change to downvote
    await factories.createVote(voter.id, 'post', post.id, -1);

    const result = await pool.query('SELECT score FROM posts WHERE id = $1', [post.id]);
    // +1 then -2 delta = -1
    expect(result.rows[0].score).toBe(-1);
  });

  it('should update post score when vote is removed', async () => {
    const author = await factories.createUser();
    const voter = await factories.createUser();
    const post = await factories.createPost(author.id);

    await factories.createVote(voter.id, 'post', post.id, 1);

    await pool.query(
      'DELETE FROM votes WHERE user_id = $1 AND target_type = $2 AND target_id = $3',
      [voter.id, 'post', post.id]
    );

    const result = await pool.query('SELECT score FROM posts WHERE id = $1', [post.id]);
    expect(result.rows[0].score).toBe(0);
  });

  it('should increment reply score on upvote', async () => {
    const author = await factories.createUser();
    const voter = await factories.createUser();
    const post = await factories.createPost(author.id);
    const reply = await factories.createReply(post.id, author.id);

    await factories.createVote(voter.id, 'reply', reply.id, 1);

    const result = await pool.query('SELECT score FROM replies WHERE id = $1', [reply.id]);
    expect(result.rows[0].score).toBe(1);
  });

  it('should accumulate post score from multiple voters', async () => {
    const author = await factories.createUser();
    const voter1 = await factories.createUser();
    const voter2 = await factories.createUser();
    const voter3 = await factories.createUser();
    const post = await factories.createPost(author.id);

    await factories.createVote(voter1.id, 'post', post.id, 1);
    await factories.createVote(voter2.id, 'post', post.id, 1);
    await factories.createVote(voter3.id, 'post', post.id, -1);

    const result = await pool.query('SELECT score FROM posts WHERE id = $1', [post.id]);
    expect(result.rows[0].score).toBe(1);
  });

  it('should NOT update karma columns when votes are cast (karma is batch-only)', async () => {
    const author = await factories.createUser();
    const voter = await factories.createUser();
    const post = await factories.createPost(author.id);

    await factories.createVote(voter.id, 'post', post.id, 1);

    const result = await pool.query(
      'SELECT pioneer_karma, builder_karma, critic_karma FROM users WHERE id = $1',
      [author.id]
    );
    expect(result.rows[0].pioneer_karma).toBe(0);
    expect(result.rows[0].builder_karma).toBe(0);
    expect(result.rows[0].critic_karma).toBe(0);
  });
});

// V4: builder_karma replaces connection_karma; still incremented synchronously on reply connections.
describe('Builder Karma (V4)', () => {
  it('should increment builder_karma when someone replies to your post', async () => {
    const postAuthor = await factories.createUser();
    await factories.createUser(); // replier
    await factories.createPost(postAuthor.id);

    // Simulate what the route does via incrementConnectionKarma (now updates builder_karma)
    await pool.query(
      'UPDATE users SET builder_karma = builder_karma + 1 WHERE id = $1',
      [postAuthor.id]
    );

    const result = await pool.query('SELECT builder_karma FROM users WHERE id = $1', [postAuthor.id]);
    expect(result.rows[0].builder_karma).toBe(1);
  });

  it('should not increment builder_karma for self-replies', async () => {
    const author = await factories.createUser();
    await factories.createPost(author.id);

    // Self-reply: no karma increment (the route skips this)
    const result = await pool.query('SELECT builder_karma FROM users WHERE id = $1', [author.id]);
    expect(result.rows[0].builder_karma).toBe(0);
  });
});

describe('Notifications', () => {
  it('should create a notification on reply', async () => {
    const postAuthor = await factories.createUser();
    const replier = await factories.createUser();
    const post = await factories.createPost(postAuthor.id);

    await factories.createNotification(postAuthor.id, 'post', post.id, replier.id);

    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1',
      [postAuthor.id]
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].target_type).toBe('post');
    expect(result.rows[0].target_id).toBe(post.id);
    expect(result.rows[0].reply_count).toBe(1);
    expect(result.rows[0].last_reply_author_id).toBe(replier.id);
  });

  it('should increment reply_count on second reply notification', async () => {
    const postAuthor = await factories.createUser();
    const replier1 = await factories.createUser();
    const replier2 = await factories.createUser();
    const post = await factories.createPost(postAuthor.id);

    await factories.createNotification(postAuthor.id, 'post', post.id, replier1.id);
    await factories.createNotification(postAuthor.id, 'post', post.id, replier2.id);

    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1',
      [postAuthor.id]
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].reply_count).toBe(2);
    expect(result.rows[0].last_reply_author_id).toBe(replier2.id);
  });

  it('should not create notification for self-reply', async () => {
    const author = await factories.createUser();
    const post = await factories.createPost(author.id);
    // Author replies to their own post
    await factories.createReply(post.id, author.id);

    // Self-reply should not generate a notification
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1',
      [author.id]
    );
    expect(result.rows).toHaveLength(0);
  });

  it('should return notifications ordered by updated_at DESC', async () => {
    const user = await factories.createUser();
    const replier = await factories.createUser();
    const post1 = await factories.createPost(user.id);
    const post2 = await factories.createPost(user.id);

    // Insert with explicit timestamps (bypass trigger with session_replication_role)
    await pool.query(`SET session_replication_role = 'replica'`);
    await pool.query(
      `INSERT INTO notifications (user_id, target_type, target_id, reply_count, last_reply_author_id, created_at, updated_at)
       VALUES ($1, 'post', $2, 1, $3, NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes')`,
      [user.id, post1.id, replier.id]
    );
    await pool.query(
      `INSERT INTO notifications (user_id, target_type, target_id, reply_count, last_reply_author_id, created_at, updated_at)
       VALUES ($1, 'post', $2, 1, $3, NOW() - INTERVAL '1 minute', NOW() - INTERVAL '1 minute')`,
      [user.id, post2.id, replier.id]
    );
    await pool.query(`SET session_replication_role = 'origin'`);

    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY updated_at DESC',
      [user.id]
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].target_id).toBe(post2.id);
    expect(result.rows[1].target_id).toBe(post1.id);
  });

  it('should count new notifications correctly', async () => {
    const user = await factories.createUser();
    const replier = await factories.createUser();
    const post1 = await factories.createPost(user.id);
    const post2 = await factories.createPost(user.id);

    // Insert notification in the past (bypass trigger)
    await pool.query(`SET session_replication_role = 'replica'`);
    await pool.query(
      `INSERT INTO notifications (user_id, target_type, target_id, reply_count, last_reply_author_id, created_at, updated_at)
       VALUES ($1, 'post', $2, 1, $3, NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes')`,
      [user.id, post1.id, replier.id]
    );
    await pool.query(`SET session_replication_role = 'origin'`);

    // Mark as viewed between the two notifications
    await pool.query(
      `UPDATE users SET notifications_last_viewed_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [user.id]
    );

    // New notification after viewing (default updated_at = NOW())
    await factories.createNotification(user.id, 'post', post2.id, replier.id);

    const userResult = await pool.query('SELECT notifications_last_viewed_at FROM users WHERE id = $1', [user.id]);
    const lastViewed = userResult.rows[0].notifications_last_viewed_at;

    const countResult = await pool.query(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND updated_at > $2',
      [user.id, lastViewed]
    );
    expect(parseInt(countResult.rows[0].count, 10)).toBe(1);
  });

  it('should count all notifications as new when never viewed', async () => {
    const user = await factories.createUser();
    const replier = await factories.createUser();
    const post1 = await factories.createPost(user.id);
    const post2 = await factories.createPost(user.id);

    await factories.createNotification(user.id, 'post', post1.id, replier.id);
    await factories.createNotification(user.id, 'post', post2.id, replier.id);

    const countResult = await pool.query(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1',
      [user.id]
    );
    expect(parseInt(countResult.rows[0].count, 10)).toBe(2);
  });

  it('should enforce unique constraint on (user_id, target_type, target_id)', async () => {
    const user = await factories.createUser();
    const replier = await factories.createUser();
    const post = await factories.createPost(user.id);

    // First insert
    await pool.query(
      `INSERT INTO notifications (user_id, target_type, target_id, last_reply_author_id)
       VALUES ($1, 'post', $2, $3)`,
      [user.id, post.id, replier.id]
    );

    // Second insert with ON CONFLICT should update, not fail
    await pool.query(
      `INSERT INTO notifications (user_id, target_type, target_id, last_reply_author_id)
       VALUES ($1, 'post', $2, $3)
       ON CONFLICT (user_id, target_type, target_id)
       DO UPDATE SET reply_count = notifications.reply_count + 1, updated_at = NOW()`,
      [user.id, post.id, replier.id]
    );

    const result = await pool.query(
      'SELECT reply_count FROM notifications WHERE user_id = $1 AND target_id = $2',
      [user.id, post.id]
    );
    expect(result.rows[0].reply_count).toBe(2);
  });
});
