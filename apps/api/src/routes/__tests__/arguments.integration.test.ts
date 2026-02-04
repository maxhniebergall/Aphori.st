import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createArgumentRepo } from '../../db/repositories/ArgumentRepo.js';
import argumentsRouter from '../arguments.js';
import { createFactories } from '../../__tests__/utils/factories.js';

describe('Arguments Routes Integration Tests', () => {
  let app: express.Application;
  let factories: ReturnType<typeof createFactories>;

  beforeEach(() => {
    const pool = globalThis.testDb.getPool();
    factories = createFactories(pool);

    // Create test Express app with arguments router
    app = express();
    app.use(express.json());
    app.use('/api/v1/arguments', argumentsRouter);
  });

  describe('GET /api/v1/arguments/posts/:id/adus', () => {
    it('should return ADUs for a post', async () => {
      const post = await factories.createPost();
      await factories.createADU('post', post.id, { text: 'Test claim 1', adu_type: 'claim' });
      await factories.createADU('post', post.id, { text: 'Test premise 1', adu_type: 'premise' });

      const response = await request(app).get(`/api/v1/arguments/posts/${post.id}/adus`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toMatchObject({
        source_id: post.id,
        adu_type: 'claim',
        text: 'Test claim 1',
      });
      expect(response.body.data[1]).toMatchObject({
        adu_type: 'premise',
        text: 'Test premise 1',
      });
    });

    it('should return empty array for post without ADUs', async () => {
      const post = await factories.createPost();

      const response = await request(app).get(`/api/v1/arguments/posts/${post.id}/adus`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });

    it('should return ADUs sorted by span_start', async () => {
      const post = await factories.createPost();
      await factories.createADU('post', post.id, { text: 'Second', span_start: 10, span_end: 16 });
      await factories.createADU('post', post.id, { text: 'First', span_start: 0, span_end: 5 });

      const response = await request(app).get(`/api/v1/arguments/posts/${post.id}/adus`);

      expect(response.body.data[0].text).toBe('First');
      expect(response.body.data[1].text).toBe('Second');
    });
  });

  describe('GET /api/v1/arguments/claims/:id', () => {
    it('should return canonical claim details', async () => {
      const claim = await factories.createCanonicalClaim(null, 'Test canonical claim');

      const response = await request(app).get(`/api/v1/arguments/claims/${claim.id}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        id: claim.id,
        representative_text: 'Test canonical claim',
      });
    });

    it('should return 404 for nonexistent claim', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app).get(`/api/v1/arguments/claims/${fakeId}`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });
  });

  describe('GET /api/v1/arguments/claims/:id/related', () => {
    it('should return argument relations for a claim', async () => {
      const post = await factories.createPost();
      const adu1 = await factories.createADU('post', post.id);
      const adu2 = await factories.createADU('post', post.id);

      const pool = globalThis.testDb.getPool();
      const repo = createArgumentRepo(pool);

      await repo.createRelations([
        { source_adu_id: adu1.id, target_adu_id: adu2.id, relation_type: 'support', confidence: 0.9 },
      ]);

      const response = await request(app).get(`/api/v1/arguments/claims/${adu1.id}/related`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.relations).toHaveLength(1);
      expect(response.body.data.relations[0]).toMatchObject({
        source_adu_id: adu1.id,
        target_adu_id: adu2.id,
        relation_type: 'support',
        confidence: 0.9,
      });
    });

    it('should return empty relations for ADU with no relations', async () => {
      const post = await factories.createPost();
      const adu = await factories.createADU('post', post.id);

      const response = await request(app).get(`/api/v1/arguments/claims/${adu.id}/related`);

      expect(response.status).toBe(200);
      expect(response.body.data.relations).toHaveLength(0);
    });
  });
});
