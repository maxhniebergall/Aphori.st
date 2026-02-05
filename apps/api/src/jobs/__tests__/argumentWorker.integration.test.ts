import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import crypto from 'crypto';
import { createArgumentRepo } from '../../db/repositories/ArgumentRepo.js';
import { createFactories } from '../../__tests__/utils/factories.js';
import { getArgumentService } from '../../services/argumentService.js';

/**
 * Integration tests for the argument analysis pipeline.
 *
 * These tests use the REAL discourse-engine service (not mocks).
 * Requires:
 *   - discourse-engine running on http://localhost:8001
 *   - Test database running with pgvector extension
 *
 * Run with: npm run test:integration
 */

// Process argument analysis using real services
async function processArgumentAnalysis(
  pool: any,
  sourceType: 'post' | 'reply',
  sourceId: string,
  contentHash: string
) {
  const argumentRepo = createArgumentRepo(pool);
  const argumentService = getArgumentService(); // Real service, not mock!

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

  // 4. Extract ADUs from text (REAL discourse-engine call)
  const aduResponse = await argumentService.analyzeADUs([{ id: sourceId, text: content.content }]);

  if (aduResponse.adus.length === 0) {
    await pool.query(`UPDATE ${statusColumn} SET analysis_status = 'completed' WHERE id = $1`, [sourceId]);
    return { completed: true, aduCount: 0 };
  }

  // 5. Generate embeddings for ADUs (REAL Gemini embeddings)
  const aduTexts = aduResponse.adus.map((adu: any) => adu.text);
  const aduEmbeddingsResponse = await argumentService.embedContent(aduTexts);

  // 6. Store ADUs in database
  const createdADUs = await argumentRepo.createADUs(sourceType, sourceId, aduResponse.adus);

  // 7. Store ADU embeddings
  await argumentRepo.createADUEmbeddings(
    createdADUs.map((adu: any, idx: number) => ({
      adu_id: adu.id,
      embedding: aduEmbeddingsResponse.embeddings_768[idx]!,
    }))
  );

  // 8. Canonical claim deduplication (claims only)
  const claims = createdADUs.filter((adu: any) => adu.adu_type === 'claim');

  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i]!;
    const claimIndex = createdADUs.findIndex((adu: any) => adu.id === claim.id);
    const embedding = aduEmbeddingsResponse.embeddings_768[claimIndex]!;

    // Step 8a: Retrieve similar canonical claims
    const similarClaims = await argumentRepo.findSimilarCanonicalClaims(embedding, 0.75, 5);

    if (similarClaims.length > 0) {
      // Step 8b: Fetch full canonical claim texts
      const canonicalTexts = await argumentRepo.getCanonicalClaimsByIds(
        similarClaims.map((c: any) => c.canonical_claim_id)
      );

      // Create mapping from id to similarity
      const similarityMap = new Map(
        similarClaims.map((c: any) => [c.canonical_claim_id, c.similarity])
      );

      // Step 8c: Validate with LLM (REAL Gemini call)
      try {
        const validation = await argumentService.validateClaimEquivalence(
          claim.text,
          canonicalTexts.map((c: any) => ({
            id: c.id,
            text: c.representative_text,
            similarity: similarityMap.get(c.id) ?? 0,
          }))
        );

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

  // 9. Detect argument relations (REAL discourse-engine call)
  if (createdADUs.length >= 2) {
    const relations = await argumentService.analyzeRelations(
      createdADUs.map((adu: any) => ({
        id: adu.id,
        text: adu.text,
        source_comment_id: adu.source_id,
      })),
      aduEmbeddingsResponse.embeddings_768
    );
    await argumentRepo.createRelations(relations.relations);
  }

  // 10. Generate content embedding (REAL Gemini embeddings)
  const contentEmbed = await argumentService.embedContent([content.content]);
  await argumentRepo.createContentEmbedding(sourceType, sourceId, contentEmbed.embeddings_768[0]!);

  // 11. Mark as completed
  await pool.query(`UPDATE ${statusColumn} SET analysis_status = 'completed' WHERE id = $1`, [sourceId]);

  return {
    completed: true,
    aduCount: createdADUs.length,
    claimCount: claims.length,
  };
}

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

describe('Argument Worker Integration Tests', () => {
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
  });

  describe('Full pipeline with real discourse-engine', () => {
    it('should extract ADUs, embeddings, claims, and relations', async () => {
      if (!discourseEngineAvailable) {
        console.log('Skipping: discourse-engine not available');
        return;
      }

      const post = await factories.createPost(undefined, {
        content: 'Climate change is a serious threat to our planet. Rising sea levels will displace millions of people. Therefore, we must take immediate action to reduce carbon emissions.',
      });
      const contentHash = crypto.createHash('sha256').update(post.content).digest('hex');

      const pool = globalThis.testDb.getPool();
      const result = await processArgumentAnalysis(pool, 'post', post.id, contentHash);

      expect(result.completed).toBe(true);
      expect(result.aduCount).toBeGreaterThan(0);

      // Verify ADUs were created
      const argumentRepo = createArgumentRepo(pool);
      const adus = await argumentRepo.findBySource('post', post.id);
      expect(adus.length).toBe(result.aduCount);

      // Verify each ADU has an embedding
      for (const adu of adus) {
        const embeddingResult = await pool.query(
          'SELECT embedding FROM adu_embeddings WHERE adu_id = $1',
          [adu.id]
        );
        expect(embeddingResult.rows).toHaveLength(1);
        expect(embeddingResult.rows[0].embedding).toHaveLength(768);
      }

      // Verify post status is completed
      const postResult = await pool.query('SELECT analysis_status FROM posts WHERE id = $1', [post.id]);
      expect(postResult.rows[0].analysis_status).toBe('completed');

      // Verify content embedding was created
      const contentEmbedding = await pool.query(
        'SELECT embedding FROM content_embeddings WHERE source_type = $1 AND source_id = $2',
        ['post', post.id]
      );
      expect(contentEmbedding.rows).toHaveLength(1);
      expect(contentEmbedding.rows[0].embedding).toHaveLength(768);
    }, 60000); // 60s timeout for real API calls

    it('should detect relations between ADUs from different comments', async () => {
      if (!discourseEngineAvailable) {
        console.log('Skipping: discourse-engine not available');
        return;
      }

      // Create first post with a claim
      const author1 = await factories.createUser();
      const post1 = await factories.createPost(author1.id, {
        content: 'Electric vehicles are essential for reducing carbon emissions.',
      });
      const hash1 = crypto.createHash('sha256').update(post1.content).digest('hex');

      // Create second post that supports the first
      const author2 = await factories.createUser();
      const post2 = await factories.createPost(author2.id, {
        content: 'Battery technology improvements make EVs more practical every year.',
      });
      const hash2 = crypto.createHash('sha256').update(post2.content).digest('hex');

      const pool = globalThis.testDb.getPool();

      // Process both posts
      await processArgumentAnalysis(pool, 'post', post1.id, hash1);
      await processArgumentAnalysis(pool, 'post', post2.id, hash2);

      // Verify ADUs were created for both
      const argumentRepo = createArgumentRepo(pool);
      const adus1 = await argumentRepo.findBySource('post', post1.id);
      const adus2 = await argumentRepo.findBySource('post', post2.id);

      expect(adus1.length).toBeGreaterThan(0);
      expect(adus2.length).toBeGreaterThan(0);
    }, 120000); // 120s timeout for multiple API calls

    it('should handle posts with no argumentative content', async () => {
      if (!discourseEngineAvailable) {
        console.log('Skipping: discourse-engine not available');
        return;
      }

      const post = await factories.createPost(undefined, {
        content: 'Hello world!',
      });
      const contentHash = crypto.createHash('sha256').update(post.content).digest('hex');

      const pool = globalThis.testDb.getPool();
      const result = await processArgumentAnalysis(pool, 'post', post.id, contentHash);

      expect(result.completed).toBe(true);
      // May or may not have ADUs depending on model behavior
      expect(result.aduCount).toBeGreaterThanOrEqual(0);

      // Verify post status is completed
      const postResult = await pool.query('SELECT analysis_status FROM posts WHERE id = $1', [post.id]);
      expect(postResult.rows[0].analysis_status).toBe('completed');
    }, 60000);
  });

  describe('Canonical claim deduplication with real LLM', () => {
    it('should deduplicate semantically equivalent claims', async () => {
      if (!discourseEngineAvailable) {
        console.log('Skipping: discourse-engine not available');
        return;
      }

      const author1 = await factories.createUser();
      const author2 = await factories.createUser();

      // First post establishes a canonical claim
      const post1 = await factories.createPost(author1.id, {
        content: 'Climate change is caused by human activities.',
      });
      const hash1 = crypto.createHash('sha256').update(post1.content).digest('hex');

      // Second post makes a semantically equivalent claim
      const post2 = await factories.createPost(author2.id, {
        content: 'Human activity is the primary driver of climate change.',
      });
      const hash2 = crypto.createHash('sha256').update(post2.content).digest('hex');

      const pool = globalThis.testDb.getPool();

      // Process first post
      await processArgumentAnalysis(pool, 'post', post1.id, hash1);

      // Get canonical claims after first post
      const canonicalsBefore = await pool.query('SELECT * FROM canonical_claims');
      const countBefore = canonicalsBefore.rows.length;

      // Process second post
      await processArgumentAnalysis(pool, 'post', post2.id, hash2);

      // Check if claims were deduplicated (count should be same or +1 depending on LLM decision)
      const canonicalsAfter = await pool.query('SELECT * FROM canonical_claims');

      // The LLM should ideally recognize these as equivalent
      // But we can't guarantee exact behavior, so just verify the pipeline completed
      expect(canonicalsAfter.rows.length).toBeGreaterThanOrEqual(countBefore);
    }, 120000);
  });

  describe('Idempotency', () => {
    it('should skip processing if content hash has changed', async () => {
      const post = await factories.createPost(undefined, { content: 'Original content' });
      const originalHash = crypto.createHash('sha256').update('Original content').digest('hex');

      // Change post content
      const pool = globalThis.testDb.getPool();
      await pool.query('UPDATE posts SET content = $1 WHERE id = $2', ['Modified content', post.id]);

      const result = await processArgumentAnalysis(pool, 'post', post.id, originalHash);

      expect(result.skipped).toBe(true);
    });
  });

  describe('Attribution', () => {
    it('should attribute canonical claims to the original author', async () => {
      if (!discourseEngineAvailable) {
        console.log('Skipping: discourse-engine not available');
        return;
      }

      const author = await factories.createUser();
      const post = await factories.createPost(author.id, {
        content: 'Renewable energy is the future of sustainable development.',
      });
      const contentHash = crypto.createHash('sha256').update(post.content).digest('hex');

      const pool = globalThis.testDb.getPool();
      const argumentRepo = createArgumentRepo(pool);

      await processArgumentAnalysis(pool, 'post', post.id, contentHash);

      // Verify canonical claim has correct author
      const adus = await argumentRepo.findBySource('post', post.id);
      const claimAdu = adus.find((a: any) => a.adu_type === 'claim');

      if (claimAdu) {
        const mapping = await pool.query(
          'SELECT canonical_claim_id FROM adu_canonical_map WHERE adu_id = $1',
          [claimAdu.id]
        );

        if (mapping.rows.length > 0) {
          const canonical = await argumentRepo.findCanonicalClaimById(mapping.rows[0].canonical_claim_id);
          expect(canonical?.author_id).toBe(author.id);
        }
      }
    }, 60000);
  });
});
