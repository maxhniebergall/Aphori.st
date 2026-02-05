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

  describe('GET /api/v1/arguments/posts/:id/canonical-mappings', () => {
    it('should return canonical mappings for post ADUs', async () => {
      const post = await factories.createPost();
      const adu1 = await factories.createADU('post', post.id, { text: 'Claim 1' });
      const adu2 = await factories.createADU('post', post.id, { text: 'Claim 2' });
      const canonical = await factories.createCanonicalClaim(null, 'Canonical claim text');

      await factories.linkADUToCanonical(adu1.id, canonical.id, 0.95);
      await factories.linkADUToCanonical(adu2.id, canonical.id, 0.88);

      const response = await request(app).get(`/api/v1/arguments/posts/${post.id}/canonical-mappings`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toMatchObject({
        canonical_claim_id: canonical.id,
        representative_text: 'Canonical claim text',
        adu_count: 2,
      });
    });

    it('should return empty array for post without ADUs', async () => {
      const post = await factories.createPost();

      const response = await request(app).get(`/api/v1/arguments/posts/${post.id}/canonical-mappings`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });

    it('should return empty array for post with ADUs but no canonical mappings', async () => {
      const post = await factories.createPost();
      await factories.createADU('post', post.id);

      const response = await request(app).get(`/api/v1/arguments/posts/${post.id}/canonical-mappings`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('GET /api/v1/arguments/canonical-claims/:id/related-posts', () => {
    it('should return related posts for a canonical claim', async () => {
      const author = await factories.createUser();
      const post = await factories.createPost(author.id, {
        title: 'Related Post',
        content: 'Post content here.',
      });
      const adu = await factories.createADU('post', post.id, { text: 'A claim' });
      const canonical = await factories.createCanonicalClaim(null, 'Canonical text');
      await factories.linkADUToCanonical(adu.id, canonical.id, 0.92);

      const response = await request(app).get(`/api/v1/arguments/canonical-claims/${canonical.id}/related-posts`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        source_type: 'post',
        source_id: post.id,
        title: 'Related Post',
        content: 'Post content here.',
        author_id: author.id,
        adu_text: 'A claim',
        similarity_score: 0.92,
      });
    });

    it('should respect exclude_source_id query parameter', async () => {
      const post1 = await factories.createPost(undefined, { content: 'Post 1' });
      const post2 = await factories.createPost(undefined, { content: 'Post 2' });
      const adu1 = await factories.createADU('post', post1.id);
      const adu2 = await factories.createADU('post', post2.id);
      const canonical = await factories.createCanonicalClaim();
      await factories.linkADUToCanonical(adu1.id, canonical.id, 0.95);
      await factories.linkADUToCanonical(adu2.id, canonical.id, 0.90);

      const response = await request(app).get(
        `/api/v1/arguments/canonical-claims/${canonical.id}/related-posts?exclude_source_id=${post1.id}`
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].source_id).toBe(post2.id);
    });

    it('should respect limit query parameter', async () => {
      const canonical = await factories.createCanonicalClaim();

      for (let i = 0; i < 5; i++) {
        const post = await factories.createPost();
        const adu = await factories.createADU('post', post.id);
        await factories.linkADUToCanonical(adu.id, canonical.id, 0.9 - i * 0.01);
      }

      const response = await request(app).get(
        `/api/v1/arguments/canonical-claims/${canonical.id}/related-posts?limit=2`
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });

    it('should return empty array for nonexistent canonical claim', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app).get(`/api/v1/arguments/canonical-claims/${fakeId}/related-posts`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });
  });
});
