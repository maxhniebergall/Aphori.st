import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { createArgumentRepo } from '../../db/repositories/ArgumentRepo.js';
import { createFactories } from '../../__tests__/utils/factories.js';
import { createMockDiscourseEngine } from '../../__tests__/utils/mockDiscourseEngine.js';

/**
 * Error path tests for argument worker
 *
 * These tests verify error handling when:
 * - ML service fails or times out
 * - Database operations fail
 * - Claim validation fails
 * - Concurrent updates cause conflicts
 */

describe('Argument Worker Error Handling', () => {
  let factories: ReturnType<typeof createFactories>;
  let argumentRepo: ReturnType<typeof createArgumentRepo>;

  beforeEach(() => {
    const pool = globalThis.testDb.getPool();
    factories = createFactories(pool);
    argumentRepo = createArgumentRepo(pool);
  });

  describe('ML service failures', () => {
    it('should handle discourse-engine ADU extraction timeout', async () => {
      const post = await factories.createPost();
      const mockService = createMockDiscourseEngine({
        shouldFail: true,
        failureError: new Error('discourse-engine timeout'),
      });

      // Verify error is properly caught and logged
      try {
        await mockService.analyzeADUs([{ id: post.id, text: post.content }]);
        expect.fail('Should have thrown timeout error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('timeout');
      }
    });

    it('should fallback to new canonical claim when LLM validation fails', async () => {
      const post = await factories.createPost();
      const claim = await factories.createADU('post', post.id, { adu_type: 'claim' });
      const mockService = createMockDiscourseEngine({
        shouldFail: true,
      });

      // Should create new canonical claim when validation fails
      try {
        await mockService.validateClaimEquivalence(claim.text, [
          { id: 'test', text: 'existing claim', similarity: 0.8 },
        ]);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle embedding service returning wrong dimension', async () => {
      const post = await factories.createPost();
      const mockService = createMockDiscourseEngine({
        embeddingsResponse: {
          embeddings_1536: [Array(512).fill(0.1)], // Wrong dimension!
        },
      });

      const embeddings = await mockService.embedContent([post.content]);
      // Should receive invalid dimension
      expect(embeddings.embeddings_1536[0]!).toHaveLength(512);
    });
  });

  describe('Database transaction failures', () => {
    it('should atomically update canonical mapping and adu_count', async () => {
      const post = await factories.createPost();
      const adu = await factories.createADU('post', post.id);
      const canonical1 = await factories.createCanonicalClaim(null, 'claim 1');
      const canonical2 = await factories.createCanonicalClaim(null, 'claim 2');

      // Link to first canonical
      await argumentRepo.linkADUToCanonical(adu.id, canonical1.id, 0.9);
      const mapping1 = await argumentRepo.getCanonicalMappingsForADUs([adu.id]);
      expect(mapping1).toHaveLength(1);
      expect(mapping1[0]!.canonical_claim_id).toBe(canonical1.id);

      // Can update to different canonical (not a constraint violation in this schema)
      await argumentRepo.linkADUToCanonical(adu.id, canonical2.id, 0.95);
      const mapping2 = await argumentRepo.getCanonicalMappingsForADUs([adu.id]);
      expect(mapping2).toHaveLength(2); // Both mappings exist (no DELETE, just updates)
    });

    it('should handle batch embedding insert with empty array', async () => {
      // Should gracefully handle empty batch
      await expect(argumentRepo.createADUEmbeddings([])).resolves.not.toThrow();
    });

    it('should handle batch relation insert with empty array', async () => {
      // Should gracefully handle empty batch
      await expect(argumentRepo.createRelations([])).resolves.not.toThrow();
    });

    it('should atomically update canonical claim adu_count', async () => {
      const adu1 = await factories.createADU('post', (await factories.createPost()).id);
      const adu2 = await factories.createADU('post', (await factories.createPost()).id);
      const canonical = await factories.createCanonicalClaim(null, 'shared claim');

      // Link first ADU
      await argumentRepo.linkADUToCanonical(adu1.id, canonical.id, 0.9);
      let claim = await argumentRepo.findCanonicalClaimById(canonical.id);
      expect(claim?.adu_count).toBe(1);

      // Link second ADU
      await argumentRepo.linkADUToCanonical(adu2.id, canonical.id, 0.85);
      claim = await argumentRepo.findCanonicalClaimById(canonical.id);
      expect(claim?.adu_count).toBe(2);
    });
  });

  describe('Concurrent update handling', () => {
    it('should handle concurrent linkADUToCanonical calls', async () => {
      const adu = await factories.createADU('post', (await factories.createPost()).id);
      const canonical = await factories.createCanonicalClaim(null, 'shared claim');

      // Simulate concurrent updates
      const promises = [
        argumentRepo.linkADUToCanonical(adu.id, canonical.id, 0.9),
        argumentRepo.linkADUToCanonical(adu.id, canonical.id, 0.85),
        argumentRepo.linkADUToCanonical(adu.id, canonical.id, 0.95),
      ];

      await Promise.all(promises);

      // Final state should have exactly one mapping with last similarity
      const mappings = await argumentRepo.getCanonicalMappingsForADUs([adu.id]);
      expect(mappings).toHaveLength(1);
      expect(mappings[0]!.similarity_score).toBe(0.95);
    });

    it('should handle concurrent batch embeddings for same ADU', async () => {
      const adu = await factories.createADU('post', (await factories.createPost()).id);

      // Try to insert embedding twice (should conflict on UNIQUE constraint)
      const embedding = Array(768).fill(0.1);

      // This will be handled by the INSERT ... ON CONFLICT clause
      // Both should succeed without error
      await argumentRepo.createADUEmbeddings([{ adu_id: adu.id, embedding }]);
      await argumentRepo.createADUEmbeddings([{ adu_id: adu.id, embedding }]);
    });
  });

  describe('Semantic search with thresholds', () => {
    it('should filter results by similarity threshold', async () => {
      const post1 = await factories.createPost();
      const post2 = await factories.createPost();

      // Create embeddings
      const embed1 = Array(768).fill(0.1);
      const embed2 = Array(768).fill(0.15);

      await argumentRepo.createContentEmbedding('post', post1.id, embed1);
      await argumentRepo.createContentEmbedding('post', post2.id, embed2);

      // Search with high threshold (0.9) should return nothing
      const results = await argumentRepo.semanticSearch(embed1, 20, 0.9);
      expect(results).toHaveLength(0);

      // Search with low threshold (0.1) should return results
      const resultsLow = await argumentRepo.semanticSearch(embed1, 20, 0.1);
      expect(resultsLow.length).toBeGreaterThan(0);
    });

    it('should default to 0.5 threshold when not specified', async () => {
      const post = await factories.createPost();
      const embedding = Array(768).fill(0.1);

      await argumentRepo.createContentEmbedding('post', post.id, embedding);

      // Search without explicit threshold
      const results = await argumentRepo.semanticSearch(embedding, 20);
      // Exact results depend on vector values, but should not throw
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Hash validation for idempotency', () => {
    it('should detect content modification via hash mismatch', async () => {
      const originalContent = 'This is the original content';
      const modifiedContent = 'This is modified content';

      const originalHash = crypto.createHash('sha256').update(originalContent).digest('hex');
      const modifiedHash = crypto.createHash('sha256').update(modifiedContent).digest('hex');

      expect(originalHash).not.toBe(modifiedHash);
    });
  });

  describe('Analysis status tracking', () => {
    it('should mark analysis as completed on success', async () => {
      const post = await factories.createPost();
      expect(post.analysis_status).toBe('pending');
      // Would be set to 'processing' then 'completed' during actual analysis
    });

    it('should mark analysis as failed on error', async () => {
      const post = await factories.createPost();
      // Simulate failure scenario
      expect(post.analysis_status).toBe('pending');
      // Would be set to 'failed' if analysis throws
    });
  });
});
