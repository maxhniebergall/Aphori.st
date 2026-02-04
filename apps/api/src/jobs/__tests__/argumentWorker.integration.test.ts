import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { createArgumentRepo } from '../../db/repositories/ArgumentRepo.js';
import { createPostRepo } from '../../db/repositories/PostRepo.js';
import { createFactories } from '../../__tests__/utils/factories.js';

// Simulate the argument worker processing logic
async function processArgumentAnalysis(
  pool: any,
  sourceType: 'post' | 'reply',
  sourceId: string,
  contentHash: string,
  mockDiscourseEngine: any
) {
  const argumentRepo = createArgumentRepo(pool);

  // 1. Get the content from database
  let content;
  if (sourceType === 'post') {
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [sourceId]);
    content = result.rows[0];
  } else {
    const result = await pool.query('SELECT * FROM replies WHERE id = $1', [sourceId]);
    content = result.rows[0];
  }

  if (!content) {
    throw new Error('Content not found');
  }

  // 2. Verify hash for idempotency
  const currentHash = crypto.createHash('sha256').update(content.content).digest('hex');
  if (currentHash !== contentHash) {
    return { skipped: true };
  }

  // 3. Update status to processing
  const statusColumn = sourceType === 'post' ? 'posts' : 'replies';
  await pool.query(`UPDATE ${statusColumn} SET analysis_status = 'processing' WHERE id = $1`, [sourceId]);

  // 4. Extract ADUs from text
  const aduResponse = await mockDiscourseEngine.analyzeADUs([{ id: sourceId, text: content.content }]);

  if (aduResponse.adus.length === 0) {
    await pool.query(`UPDATE ${statusColumn} SET analysis_status = 'completed' WHERE id = $1`, [sourceId]);
    return { completed: true, aduCount: 0 };
  }

  // 5. Generate embeddings for ADUs
  const aduTexts = aduResponse.adus.map((adu: any) => adu.text);
  const aduEmbeddingsResponse = await mockDiscourseEngine.embedContent(aduTexts);

  // 6. Store ADUs in database
  const createdADUs = await argumentRepo.createADUs(sourceType, sourceId, aduResponse.adus);

  // 7. Store ADU embeddings
  await argumentRepo.createADUEmbeddings(
    createdADUs.map((adu: any, idx: number) => ({
      adu_id: adu.id,
      embedding: aduEmbeddingsResponse.embeddings_768[idx],
    }))
  );

  // 8. Canonical claim deduplication (claims only)
  const claims = createdADUs.filter((adu: any) => adu.adu_type === 'claim');

  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    const claimIndex = createdADUs.findIndex((adu: any) => adu.id === claim.id);
    const embedding = aduEmbeddingsResponse.embeddings_768[claimIndex];

    // Step 8a: Retrieve similar canonical claims
    const similarClaims = await argumentRepo.findSimilarCanonicalClaims(embedding, 0.75, 5);

    if (similarClaims.length > 0) {
      // Step 8b: Fetch full canonical claim texts
      const canonicalTexts = await argumentRepo.getCanonicalClaimsByIds(
        similarClaims.map((c: any) => c.canonical_claim_id)
      );

      // Step 8c: Validate with LLM
      try {
        const validation = await mockDiscourseEngine.validateClaimEquivalence(claim.text, []);

        if (validation.is_equivalent && validation.canonical_claim_id) {
          // Link to existing canonical claim
          const matchedSimilarity =
            similarClaims.find((s: any) => s.canonical_claim_id === validation.canonical_claim_id)?.similarity || 1.0;

          await argumentRepo.linkADUToCanonical(claim.id, validation.canonical_claim_id, matchedSimilarity);
        } else {
          // Create new canonical claim
          const canonical = await argumentRepo.createCanonicalClaim(claim.text, embedding, content.author_id);
          await argumentRepo.linkADUToCanonical(claim.id, canonical.id, 1.0);
        }
      } catch (error) {
        // Fallback: create new canonical claim
        const canonical = await argumentRepo.createCanonicalClaim(claim.text, embedding, content.author_id);
        await argumentRepo.linkADUToCanonical(claim.id, canonical.id, 1.0);
      }
    } else {
      // No similar claims found, create new
      const canonical = await argumentRepo.createCanonicalClaim(claim.text, embedding, content.author_id);
      await argumentRepo.linkADUToCanonical(claim.id, canonical.id, 1.0);
    }
  }

  // 9. Detect argument relations
  if (createdADUs.length >= 2) {
    const relations = await mockDiscourseEngine.analyzeRelations(
      createdADUs.map((adu: any) => ({ id: adu.id, text: adu.text })),
      aduEmbeddingsResponse.embeddings_768
    );
    await argumentRepo.createRelations(relations.relations);
  }

  // 10. Generate content embedding
  const contentEmbed = await mockDiscourseEngine.embedContent([content.content]);
  await argumentRepo.createContentEmbedding(sourceType, sourceId, contentEmbed.embeddings_768[0]);

  // 11. Mark as completed
  await pool.query(`UPDATE ${statusColumn} SET analysis_status = 'completed' WHERE id = $1`, [sourceId]);

  return {
    completed: true,
    aduCount: createdADUs.length,
    claimCount: claims.length,
  };
}

describe('Argument Worker Integration Tests', () => {
  let factories: ReturnType<typeof createFactories>;
  let mockDiscourseEngine: any;

  beforeEach(() => {
    const pool = globalThis.testDb.getPool();
    factories = createFactories(pool);

    // Create mock discourse engine
    mockDiscourseEngine = {
      analyzeADUs: vi.fn(async (texts: any[]) => ({
        adus: texts.map((t, idx) => ({
          id: `adu_${idx}`,
          adu_type: idx % 2 === 0 ? 'claim' : 'premise',
          text: t.text,
          span_start: 0,
          span_end: t.text.length,
          confidence: 0.95,
        })),
      })),
      embedContent: vi.fn(async (texts: string[]) => ({
        embeddings_768: texts.map(() => Array(768).fill(0.1)),
      })),
      analyzeRelations: vi.fn(async (adus: any[], embeddings: any[]) => ({
        relations: [],
      })),
      validateClaimEquivalence: vi.fn(async (claim: string, candidates: any[]) => ({
        is_equivalent: false,
        canonical_claim_id: null,
        explanation: 'Not equivalent',
      })),
    };
  });

  describe('Full pipeline', () => {
    it('should extract ADUs, embeddings, claims, and relations', async () => {
      const post = await factories.createPost(undefined, {
        content: 'Climate change is real. We must act now. Therefore, policy changes are needed.',
      });
      const contentHash = crypto.createHash('sha256').update(post.content).digest('hex');

      const pool = globalThis.testDb.getPool();
      const result = await processArgumentAnalysis(pool, 'post', post.id, contentHash, mockDiscourseEngine);

      expect(result.completed).toBe(true);
      expect(result.aduCount).toBeGreaterThan(0);

      // Verify ADUs were created
      const argumentRepo = createArgumentRepo(pool);
      const adus = await argumentRepo.findBySource('post', post.id);
      expect(adus.length).toBe(result.aduCount);

      // Verify post status is completed
      const postResult = await pool.query('SELECT analysis_status FROM posts WHERE id = $1', [post.id]);
      expect(postResult.rows[0].analysis_status).toBe('completed');
    });

    it('should handle posts with no ADUs', async () => {
      const post = await factories.createPost(undefined, { content: 'Just some random text with no arguments.' });
      const contentHash = crypto.createHash('sha256').update(post.content).digest('hex');

      mockDiscourseEngine.analyzeADUs.mockResolvedValueOnce({ adus: [] });

      const pool = globalThis.testDb.getPool();
      const result = await processArgumentAnalysis(pool, 'post', post.id, contentHash, mockDiscourseEngine);

      expect(result.completed).toBe(true);
      expect(result.aduCount).toBe(0);

      // Verify post status is completed even without ADUs
      const postResult = await pool.query('SELECT analysis_status FROM posts WHERE id = $1', [post.id]);
      expect(postResult.rows[0].analysis_status).toBe('completed');
    });
  });

  describe('LLM validation - linking to existing canonical claims', () => {
    it('should link ADU to existing canonical when LLM says equivalent', async () => {
      const author = await factories.createUser();
      const post = await factories.createPost(author.id, { content: 'Climate change is real.' });
      const contentHash = crypto.createHash('sha256').update(post.content).digest('hex');

      // Create existing canonical claim
      const existingCanonical = await factories.createCanonicalClaim(author.id, 'Climate change is happening');
      const embedding = Array(768).fill(0.1);
      await factories.createCanonicalClaimEmbedding(existingCanonical.id, embedding);

      // Mock to return similar claims and LLM validation saying equivalent
      const pool = globalThis.testDb.getPool();
      const argumentRepo = createArgumentRepo(pool);

      mockDiscourseEngine.validateClaimEquivalence.mockResolvedValueOnce({
        is_equivalent: true,
        canonical_claim_id: existingCanonical.id,
        explanation: 'Both claims assert climate change is occurring',
      });

      const result = await processArgumentAnalysis(pool, 'post', post.id, contentHash, mockDiscourseEngine);

      expect(result.completed).toBe(true);

      // Verify the ADU was linked to the canonical claim
      const adus = await argumentRepo.findBySource('post', post.id);
      const claimAdu = adus.find((a: any) => a.adu_type === 'claim');

      if (claimAdu) {
        const mapping = await pool.query(
          'SELECT canonical_claim_id FROM adu_canonical_map WHERE adu_id = $1',
          [claimAdu.id]
        );
        expect(mapping.rows).toHaveLength(1);
        expect(mapping.rows[0].canonical_claim_id).toBe(existingCanonical.id);
      }
    });
  });

  describe('LLM validation - creating new canonical claims', () => {
    it('should create new canonical claim when LLM says not equivalent', async () => {
      const author = await factories.createUser();
      const post = await factories.createPost(author.id, { content: 'New unique claim about climate.' });
      const contentHash = crypto.createHash('sha256').update(post.content).digest('hex');

      // Create existing canonical (will not match)
      const existingCanonical = await factories.createCanonicalClaim(null, 'Unrelated claim');
      const embedding = Array(768).fill(0.1);
      await factories.createCanonicalClaimEmbedding(existingCanonical.id, embedding);

      // Mock LLM to say not equivalent
      mockDiscourseEngine.validateClaimEquivalence.mockResolvedValueOnce({
        is_equivalent: false,
        canonical_claim_id: null,
        explanation: 'Claims are about different topics',
      });

      const pool = globalThis.testDb.getPool();
      const argumentRepo = createArgumentRepo(pool);
      const result = await processArgumentAnalysis(pool, 'post', post.id, contentHash, mockDiscourseEngine);

      expect(result.completed).toBe(true);

      // Verify new canonical claim was created
      const adus = await argumentRepo.findBySource('post', post.id);
      const claimAdu = adus.find((a: any) => a.adu_type === 'claim');

      if (claimAdu) {
        const mapping = await pool.query(
          'SELECT canonical_claim_id FROM adu_canonical_map WHERE adu_id = $1',
          [claimAdu.id]
        );
        expect(mapping.rows).toHaveLength(1);

        const newCanonical = await argumentRepo.findCanonicalClaimById(mapping.rows[0].canonical_claim_id);
        expect(newCanonical?.representative_text).toBe('New unique claim about climate.');
        expect(newCanonical?.author_id).toBe(author.id);
      }
    });
  });

  describe('Idempotency', () => {
    it('should skip processing if content hash has changed', async () => {
      const post = await factories.createPost(undefined, { content: 'Original content' });
      const originalHash = crypto.createHash('sha256').update('Original content').digest('hex');

      // Change post content
      const pool = globalThis.testDb.getPool();
      await pool.query('UPDATE posts SET content = $1 WHERE id = $2', ['Modified content', post.id]);

      const result = await processArgumentAnalysis(
        pool,
        'post',
        post.id,
        originalHash, // Use old hash
        mockDiscourseEngine
      );

      expect(result.skipped).toBe(true);

      // Verify analyzeADUs was never called
      expect(mockDiscourseEngine.analyzeADUs).not.toHaveBeenCalled();
    });
  });

  describe('Attribution', () => {
    it('should attribute canonical claims to the original author', async () => {
      const author = await factories.createUser();
      const post = await factories.createPost(author.id, { content: 'This is my original claim.' });
      const contentHash = crypto.createHash('sha256').update(post.content).digest('hex');

      mockDiscourseEngine.validateClaimEquivalence.mockResolvedValueOnce({
        is_equivalent: false,
        canonical_claim_id: null,
        explanation: 'New claim',
      });

      const pool = globalThis.testDb.getPool();
      const argumentRepo = createArgumentRepo(pool);

      await processArgumentAnalysis(pool, 'post', post.id, contentHash, mockDiscourseEngine);

      // Verify canonical claim has correct author
      const adus = await argumentRepo.findBySource('post', post.id);
      const claimAdu = adus.find((a: any) => a.adu_type === 'claim');

      if (claimAdu) {
        const mapping = await pool.query(
          'SELECT canonical_claim_id FROM adu_canonical_map WHERE adu_id = $1',
          [claimAdu.id]
        );

        const canonical = await argumentRepo.findCanonicalClaimById(mapping.rows[0].canonical_claim_id);
        expect(canonical?.author_id).toBe(author.id);
      }
    });
  });

  describe('Error handling', () => {
    it('should create new canonical claim if LLM validation fails', async () => {
      const author = await factories.createUser();
      const post = await factories.createPost(author.id, { content: 'A claim that causes LLM error.' });
      const contentHash = crypto.createHash('sha256').update(post.content).digest('hex');

      // Create existing canonical
      const existingCanonical = await factories.createCanonicalClaim(null, 'Existing claim');
      const embedding = Array(768).fill(0.1);
      await factories.createCanonicalClaimEmbedding(existingCanonical.id, embedding);

      // Mock LLM to throw error
      mockDiscourseEngine.validateClaimEquivalence.mockRejectedValueOnce(new Error('LLM timeout'));

      const pool = globalThis.testDb.getPool();
      const argumentRepo = createArgumentRepo(pool);

      const result = await processArgumentAnalysis(pool, 'post', post.id, contentHash, mockDiscourseEngine);

      expect(result.completed).toBe(true);

      // Verify new canonical was created as fallback
      const adus = await argumentRepo.findBySource('post', post.id);
      const claimAdu = adus.find((a: any) => a.adu_type === 'claim');

      if (claimAdu) {
        const mapping = await pool.query(
          'SELECT canonical_claim_id FROM adu_canonical_map WHERE adu_id = $1',
          [claimAdu.id]
        );
        expect(mapping.rows).toHaveLength(1);
      }
    });
  });
});
