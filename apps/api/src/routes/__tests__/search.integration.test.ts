import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createFactories } from '../../__tests__/utils/factories.js';
import { getArgumentService } from '../../services/argumentService.js';

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

// Import router AFTER mocking
const { default: searchRouter } = await import('../search.js');

/**
 * Integration tests for search routes.
 *
 * These tests use the REAL discourse-engine service for embedding generation.
 * Requires:
 *   - discourse-engine running on http://localhost:8001
 *   - Test database running with pgvector extension
 *
 * Run with: npm run test:integration
 */

// Check if discourse-engine is available
async function isDiscourseEngineAvailable(): Promise<boolean> {
  try {
    const service = getArgumentService();
    const health = await service.healthCheck();
    return health.status === 'ok';
  } catch {
    return false;
  }
}

describe('Search Routes Integration Tests', () => {
  let app: express.Application;
  let factories: ReturnType<typeof createFactories>;
  let discourseEngineAvailable = false;

  beforeAll(async () => {
    discourseEngineAvailable = await isDiscourseEngineAvailable();
    if (!discourseEngineAvailable) {
      console.warn(
        '\n⚠️  discourse-engine not available at http://localhost:8001\n' +
          '   Skipping integration tests that require real service.\n' +
          '   Start with: docker-compose up discourse-engine\n'
      );
    }
  });

  beforeEach(() => {
    const pool = globalThis.testDb.getPool();
    factories = createFactories(pool);

    // Create test Express app with search router
    app = express();
    app.use(express.json());
    app.use('/api/v1/search', searchRouter);
  });

  describe('GET /api/v1/search?type=semantic', () => {
    it('should return posts ranked by embedding similarity', async () => {
      if (!discourseEngineAvailable) {
        console.log('Skipping: discourse-engine not available');
        return;
      }

      // Create posts with different content
      const post1 = await factories.createPost(undefined, {
        content: 'Climate change is affecting our planet with rising temperatures',
      });
      const post2 = await factories.createPost(undefined, { content: 'Sports news and football updates' });

      // Simulate what the delayed worker would have done: embed and store post content
      // so the search route has indexed data to query against.
      const argumentService = getArgumentService();
      const embeddings1 = await argumentService.embedForDelayedAnalysis([post1.content]);
      const embeddings2 = await argumentService.embedForDelayedAnalysis([post2.content]);

      // Store the embeddings
      await factories.createContentEmbedding('post', post1.id, embeddings1.embeddings_1536[0]);
      await factories.createContentEmbedding('post', post2.id, embeddings2.embeddings_1536[0]);

      // Search for climate-related content
      const response = await request(app)
        .get('/api/v1/search')
        .query({ q: 'global warming and environmental issues', type: 'semantic', limit: 20 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.query).toBe('global warming and environmental issues');
      expect(response.body.data.results).toHaveLength(2);

      // Climate post should rank higher for climate query
      const firstResult = response.body.data.results[0];
      expect(firstResult.id).toBe(post1.id);
    }, 60000);

    it('should respect limit parameter', async () => {
      if (!discourseEngineAvailable) {
        console.log('Skipping: discourse-engine not available');
        return;
      }

      const argumentService = getArgumentService();

      // Simulate what the delayed worker would have done: embed and store post content.
      for (let i = 0; i < 5; i++) {
        const post = await factories.createPost(undefined, { content: `Test post number ${i}` });
        const embeddings = await argumentService.embedForDelayedAnalysis([post.content]);
        await factories.createContentEmbedding('post', post.id, embeddings.embeddings_1536[0]);
      }

      const response = await request(app)
        .get('/api/v1/search')
        .query({ q: 'test query', type: 'semantic', limit: 2 });

      expect(response.status).toBe(200);
      expect(response.body.data.results.length).toBeLessThanOrEqual(2);
    }, 60000);

    it('should return error when query parameter missing', async () => {
      const response = await request(app).get('/api/v1/search').query({ type: 'semantic' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
    });

    it('should filter unrelated content by similarity', async () => {
      if (!discourseEngineAvailable) {
        console.log('Skipping: discourse-engine not available');
        return;
      }

      const argumentService = getArgumentService();

      const post1 = await factories.createPost(undefined, {
        content: 'Artificial intelligence and machine learning are transforming technology',
      });
      const post2 = await factories.createPost(undefined, {
        content: 'Cooking recipes for delicious pasta and Italian cuisine',
      });

      // Simulate what the delayed worker would have done: embed and store post content.
      const embeddings1 = await argumentService.embedForDelayedAnalysis([post1.content]);
      const embeddings2 = await argumentService.embedForDelayedAnalysis([post2.content]);

      await factories.createContentEmbedding('post', post1.id, embeddings1.embeddings_1536[0]);
      await factories.createContentEmbedding('post', post2.id, embeddings2.embeddings_1536[0]);

      const response = await request(app)
        .get('/api/v1/search')
        .query({ q: 'neural networks and deep learning algorithms', type: 'semantic', limit: 20 });

      expect(response.status).toBe(200);
      // AI post should rank higher for AI query
      if (response.body.data.results.length > 1) {
        const firstPostId = response.body.data.results[0].id;
        expect(firstPostId).toBe(post1.id);
      }
    }, 60000);
  });

  describe('GET /api/v1/search?type=invalid', () => {
    it('should reject invalid search type', async () => {
      const response = await request(app).get('/api/v1/search').query({ q: 'test', type: 'invalid_type' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid search type');
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      // This test verifies the error response structure
      const response = await request(app).get('/api/v1/search').query({ q: 'test', type: 'semantic' });

      // Should always have a success field and either data or error
      expect(response.body).toHaveProperty('success');
      if (!response.body.success) {
        expect(response.body).toHaveProperty('error');
      }
    });
  });

  describe('Semantic search without embeddings', () => {
    it('should return empty results when no content embeddings exist', async () => {
      if (!discourseEngineAvailable) {
        console.log('Skipping: discourse-engine not available');
        return;
      }

      // Create a post without embedding
      await factories.createPost(undefined, { content: 'Post without embedding' });

      const response = await request(app).get('/api/v1/search').query({ q: 'test', type: 'semantic' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results).toHaveLength(0);
    }, 60000);
  });
});
