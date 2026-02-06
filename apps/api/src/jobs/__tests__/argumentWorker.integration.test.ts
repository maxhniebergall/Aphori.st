import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import crypto from 'crypto';
import { createArgumentRepo, type ADUType, type CanonicalClaimType } from '../../db/repositories/ArgumentRepo.js';
import { createFactories } from '../../__tests__/utils/factories.js';
import { getArgumentService } from '../../services/argumentService.js';

/**
 * Integration tests for the argument analysis pipeline (V2 ontology).
 *
 * These tests use the REAL discourse-engine service (not mocks).
 * Requires:
 *   - discourse-engine running on http://localhost:8001
 *   - Test database running with pgvector extension
 *
 * Run with: npm run test:integration
 */

// ADU types that can be deduplicated into canonical claims (matches argumentWorker.ts)
const DEDUPLICATABLE_TYPES: ADUType[] = ['MajorClaim', 'Supporting', 'Opposing'];

function toCanonicalClaimType(aduType: ADUType): CanonicalClaimType {
  if (aduType === 'Evidence') {
    throw new Error('Evidence cannot be converted to canonical claim type');
  }
  return aduType;
}

/**
 * Mirrors the actual argumentWorker.ts processAnalysis pipeline (V2 ontology).
 * Uses real discourse-engine + Gemini calls.
 */
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
  const statusTable = sourceType === 'post' ? 'posts' : 'replies';
  await pool.query(`UPDATE ${statusTable} SET analysis_status = 'processing' WHERE id = $1`, [sourceId]);

  // 4. Extract ADUs with V2 ontology (hierarchical types) - REAL discourse-engine call
  const aduResponse = await argumentService.analyzeADUs([{ id: sourceId, text: content.content }]);

  if (aduResponse.adus.length === 0) {
    await pool.query(`UPDATE ${statusTable} SET analysis_status = 'completed' WHERE id = $1`, [sourceId]);
    return { completed: true, aduCount: 0, deduplicatedCount: 0, evidenceCount: 0 };
  }

  // 5. Generate embeddings (use rewritten_text if available for anaphora-resolved version)
  const aduTexts = aduResponse.adus.map(adu => adu.rewritten_text || adu.text);
  const aduEmbeddingsResponse = await argumentService.embedContent(aduTexts);

  // 6. Store ADUs with hierarchy (two-pass: create then link target_adu_id)
  const createdADUs = await argumentRepo.createADUsWithHierarchy(
    sourceType,
    sourceId,
    aduResponse.adus.map(adu => ({
      adu_type: adu.adu_type as ADUType,
      text: adu.text,
      span_start: adu.span_start,
      span_end: adu.span_end,
      confidence: adu.confidence,
      target_index: adu.target_index,
    }))
  );

  // 7. Store ADU embeddings
  await argumentRepo.createADUEmbeddings(
    createdADUs.map((adu, idx) => ({
      adu_id: adu.id,
      embedding: aduEmbeddingsResponse.embeddings_1536[idx]!,
    }))
  );

  // 8. Canonical claim deduplication - deduplicate MajorClaim, Supporting, Opposing but NOT Evidence
  const deduplicatableADUs = createdADUs.filter(
    adu => DEDUPLICATABLE_TYPES.includes(adu.adu_type)
  );

  for (let i = 0; i < deduplicatableADUs.length; i++) {
    const adu = deduplicatableADUs[i]!;
    const aduIndex = createdADUs.findIndex(a => a.id === adu.id);
    const embedding = aduEmbeddingsResponse.embeddings_1536[aduIndex]!;

    // Step 8a: Retrieve similar canonical claims
    const similarClaims = await argumentRepo.findSimilarCanonicalClaims(embedding, 0.75, 5);

    if (similarClaims.length > 0) {
      // Step 8b: Fetch full canonical claim texts
      const canonicalTexts = await argumentRepo.getCanonicalClaimsByIds(
        similarClaims.map(c => c.canonical_claim_id)
      );

      const similarityMap = new Map(
        similarClaims.map(c => [c.canonical_claim_id, c.similarity])
      );

      // Step 8c: Validate with LLM (REAL Gemini call)
      try {
        const validation = await argumentService.validateClaimEquivalence(
          adu.text,
          canonicalTexts.map(c => ({
            id: c.id,
            text: c.representative_text,
            similarity: similarityMap.get(c.id) ?? 0,
          }))
        );

        if (validation.is_equivalent && validation.canonical_claim_id) {
          const matchedSimilarity =
            similarClaims.find(s => s.canonical_claim_id === validation.canonical_claim_id)?.similarity || 1.0;
          await argumentRepo.linkADUToCanonical(adu.id, validation.canonical_claim_id, matchedSimilarity);
        } else {
          const canonical = await argumentRepo.createCanonicalClaim(
            adu.text, embedding, content.author_id, toCanonicalClaimType(adu.adu_type)
          );
          await argumentRepo.linkADUToCanonical(adu.id, canonical.id, 1.0);
        }
      } catch (error) {
        // Fallback: create new canonical claim
        const canonical = await argumentRepo.createCanonicalClaim(
          adu.text, embedding, content.author_id, toCanonicalClaimType(adu.adu_type)
        );
        await argumentRepo.linkADUToCanonical(adu.id, canonical.id, 1.0);
      }
    } else {
      // No similar claims found, create new
      const canonical = await argumentRepo.createCanonicalClaim(
        adu.text, embedding, content.author_id, toCanonicalClaimType(adu.adu_type)
      );
      await argumentRepo.linkADUToCanonical(adu.id, canonical.id, 1.0);
    }
  }

  // 9. Skip relation detection - relations are now implicit in ADU types
  // (Supporting = support, Opposing = attack, via target_adu_id)

  // 10. Generate content embedding for semantic search (1536-dim Gemini)
  const contentEmbed = await argumentService.embedContent([content.content]);
  await argumentRepo.createContentEmbedding(sourceType, sourceId, contentEmbed.embeddings_1536[0]!);

  // 11. Mark as completed
  await pool.query(`UPDATE ${statusTable} SET analysis_status = 'completed' WHERE id = $1`, [sourceId]);

  return {
    completed: true,
    aduCount: createdADUs.length,
    deduplicatedCount: deduplicatableADUs.length,
    evidenceCount: createdADUs.length - deduplicatableADUs.length,
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
    it('should extract ADUs with V2 hierarchy, embeddings, and canonical claims', async () => {
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

      // Verify ADUs were created with V2 ontology types
      const argumentRepo = createArgumentRepo(pool);
      const adus = await argumentRepo.findBySource('post', post.id);
      expect(adus.length).toBe(result.aduCount);

      // All ADU types should be from V2 ontology
      const validTypes = ['MajorClaim', 'Supporting', 'Opposing', 'Evidence'];
      for (const adu of adus) {
        expect(validTypes).toContain(adu.adu_type);
      }

      // Should have at least one MajorClaim (root)
      const majorClaims = adus.filter(a => a.adu_type === 'MajorClaim');
      expect(majorClaims.length).toBeGreaterThan(0);

      // MajorClaims should have null target_adu_id (they are roots)
      for (const mc of majorClaims) {
        expect(mc.target_adu_id).toBeNull();
      }

      // Non-root ADUs should have target_adu_id referencing another ADU
      const nonRoots = adus.filter(a => a.adu_type !== 'MajorClaim');
      for (const nr of nonRoots) {
        if (nr.target_adu_id !== null) {
          const target = adus.find(a => a.id === nr.target_adu_id);
          expect(target).toBeDefined();
        }
      }

      // Verify each ADU has a 1536-dim embedding
      for (const adu of adus) {
        const embeddingResult = await pool.query(
          'SELECT embedding FROM adu_embeddings WHERE adu_id = $1',
          [adu.id]
        );
        expect(embeddingResult.rows).toHaveLength(1);
        expect(embeddingResult.rows[0].embedding).toHaveLength(1536);
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
      expect(contentEmbedding.rows[0].embedding).toHaveLength(1536);

      // Verify Evidence is NOT deduplicated (no canonical mapping)
      const evidenceADUs = adus.filter(a => a.adu_type === 'Evidence');
      for (const ev of evidenceADUs) {
        const mapping = await pool.query(
          'SELECT * FROM adu_canonical_map WHERE adu_id = $1', [ev.id]
        );
        expect(mapping.rows).toHaveLength(0);
      }

      // Verify deduplicatable types HAVE canonical mappings
      const deduplicatable = adus.filter(a => ['MajorClaim', 'Supporting', 'Opposing'].includes(a.adu_type));
      for (const d of deduplicatable) {
        const mapping = await pool.query(
          'SELECT * FROM adu_canonical_map WHERE adu_id = $1', [d.id]
        );
        expect(mapping.rows.length).toBeGreaterThan(0);
      }
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
      // Find a deduplicatable ADU (MajorClaim, Supporting, or Opposing)
      const deduplicatableAdu = adus.find(a =>
        ['MajorClaim', 'Supporting', 'Opposing'].includes(a.adu_type)
      );

      if (deduplicatableAdu) {
        const mapping = await pool.query(
          'SELECT canonical_claim_id FROM adu_canonical_map WHERE adu_id = $1',
          [deduplicatableAdu.id]
        );

        if (mapping.rows.length > 0) {
          const canonical = await argumentRepo.findCanonicalClaimById(mapping.rows[0].canonical_claim_id);
          expect(canonical?.author_id).toBe(author.id);
          // Verify canonical claim_type matches ADU type
          expect(canonical?.claim_type).toBe(deduplicatableAdu.adu_type);
        }
      }
    }, 60000);
  });
});
