import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createFactories } from '../../__tests__/utils/factories.js';

// Mock pool module to use the test database
vi.mock('../../db/pool.js', () => {
  const getPool = () => globalThis.testDb.getPool();
  return {
    getPool,
    query: async (text: string, params?: unknown[]) => getPool().query(text, params),
    withTransaction: async (callback: (client: any) => Promise<any>) => {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
});

// Mock auth middleware to inject a test user
vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user-id', email: 'test@example.com', user_type: 'human' };
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

// Mock rate limiters to be no-ops
vi.mock('../../middleware/rateLimit.js', () => ({
  postLimiter: (_req: any, _res: any, next: any) => next(),
  replyLimiter: (_req: any, _res: any, next: any) => next(),
}));

// Mock enqueueAnalysis to be a no-op
vi.mock('../../jobs/enqueueAnalysis.js', () => ({
  enqueueAnalysis: vi.fn().mockResolvedValue(undefined),
}));

// Import router AFTER mocking
const { default: postsRouter } = await import('../posts.js');

describe('Reply Quotes Integration Tests', () => {
  let app: express.Application;
  let factories: ReturnType<typeof createFactories>;
  let testUser: any;
  let testPost: any;

  beforeEach(async () => {
    const pool = globalThis.testDb.getPool();
    factories = createFactories(pool);

    // Create test user matching the mocked auth user
    testUser = await factories.createUser({ id: 'test-user-id', email: 'test@example.com' });
    testPost = await factories.createPost(testUser.id);

    app = express();
    app.use(express.json());
    app.use('/api/v1/posts', postsRouter);
  });

  describe('POST /api/v1/posts/:id/replies with quote fields', () => {
    it('should create a reply with all quote fields', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token')
        .send({
          content: 'I agree with this point.',
          quoted_text: 'This is a test post',
          quoted_source_type: 'post',
          quoted_source_id: testPost.id,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.quoted_text).toBe('This is a test post');
      expect(response.body.data.quoted_source_type).toBe('post');
      expect(response.body.data.quoted_source_id).toBe(testPost.id);
    });

    it('should create a reply without quote fields (existing behavior)', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token')
        .send({
          content: 'A simple reply.',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.quoted_text).toBeNull();
      expect(response.body.data.quoted_source_type).toBeNull();
      expect(response.body.data.quoted_source_id).toBeNull();
    });

    it('should reject partial quote fields (missing quoted_source_id)', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token')
        .send({
          content: 'A reply with partial quote.',
          quoted_text: 'Some text',
          quoted_source_type: 'post',
        });

      expect(response.status).toBe(400);
    });

    it('should reject partial quote fields (missing quoted_text)', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token')
        .send({
          content: 'A reply.',
          quoted_source_type: 'post',
          quoted_source_id: testPost.id,
        });

      expect(response.status).toBe(400);
    });

    it('should reject partial quote fields (missing quoted_source_type)', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token')
        .send({
          content: 'A reply.',
          quoted_text: 'Some text',
          quoted_source_id: testPost.id,
        });

      expect(response.status).toBe(400);
    });

    it('should reject quoted_text exceeding 2000 characters', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token')
        .send({
          content: 'A reply.',
          quoted_text: 'a'.repeat(2001),
          quoted_source_type: 'post',
          quoted_source_id: testPost.id,
        });

      expect(response.status).toBe(400);
    });

    it('should reject invalid quoted_source_type', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token')
        .send({
          content: 'A reply.',
          quoted_text: 'Some text',
          quoted_source_type: 'comment',
          quoted_source_id: testPost.id,
        });

      expect(response.status).toBe(400);
    });

    it('should accept quoted_text at exactly 2000 characters', async () => {
      const response = await request(app)
        .post(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token')
        .send({
          content: 'A reply.',
          quoted_text: 'a'.repeat(2000),
          quoted_source_type: 'post',
          quoted_source_id: testPost.id,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.quoted_text).toBe('a'.repeat(2000));
    });

    it('should create a reply quoting another reply', async () => {
      const reply = await factories.createReply(testPost.id, testUser.id, {
        content: 'First reply content',
      });

      const response = await request(app)
        .post(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token')
        .send({
          content: 'Responding to your reply.',
          quoted_text: 'First reply content',
          quoted_source_type: 'reply',
          quoted_source_id: reply.id,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.quoted_source_type).toBe('reply');
      expect(response.body.data.quoted_source_id).toBe(reply.id);
    });
  });

  describe('GET /api/v1/posts/:id/replies returns quote fields', () => {
    it('should return quote fields in reply list', async () => {
      // Create a reply with quote via direct DB insert
      await factories.createReply(testPost.id, testUser.id, {
        content: 'Reply with quote',
      });

      // Create a reply with quote fields through the API
      await request(app)
        .post(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token')
        .send({
          content: 'Quoted reply.',
          quoted_text: 'Test post content',
          quoted_source_type: 'post',
          quoted_source_id: testPost.id,
        });

      const response = await request(app)
        .get(`/api/v1/posts/${testPost.id}/replies`)
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const items = response.body.data.items;
      expect(items.length).toBe(2);

      // Find the quoted reply
      const quotedReply = items.find((r: any) => r.quoted_text !== null);
      expect(quotedReply).toBeDefined();
      expect(quotedReply.quoted_text).toBe('Test post content');
      expect(quotedReply.quoted_source_type).toBe('post');
      expect(quotedReply.quoted_source_id).toBe(testPost.id);

      // Find the non-quoted reply
      const normalReply = items.find((r: any) => r.quoted_text === null);
      expect(normalReply).toBeDefined();
      expect(normalReply.quoted_source_type).toBeNull();
      expect(normalReply.quoted_source_id).toBeNull();
    });
  });
});
