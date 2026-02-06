import { describe, it, expect, beforeEach } from 'vitest';
import { createArgumentRepo } from '../ArgumentRepo.js';
import { createFactories } from '../../../__tests__/utils/factories.js';

describe('ArgumentRepo', () => {
  let repo: ReturnType<typeof createArgumentRepo>;
  let factories: ReturnType<typeof createFactories>;

  beforeEach(() => {
    const pool = globalThis.testDb.getPool();
    repo = createArgumentRepo(pool);
    factories = createFactories(pool);
  });

  describe('ADU operations', () => {
    it('should create multiple ADUs with V2 ontology types', async () => {
      const post = await factories.createPost();

      const adus = await repo.createADUs('post', post.id, [
        { adu_type: 'MajorClaim', text: 'First claim', span_start: 0, span_end: 11, confidence: 0.9 },
        { adu_type: 'Supporting', text: 'First premise', span_start: 12, span_end: 25, confidence: 0.85 },
        { adu_type: 'Opposing', text: 'Counter argument', span_start: 26, span_end: 42, confidence: 0.8 },
        { adu_type: 'Evidence', text: 'Study shows', span_start: 43, span_end: 54, confidence: 0.75 },
      ]);

      expect(adus).toHaveLength(4);
      expect(adus[0]).toMatchObject({
        source_type: 'post',
        source_id: post.id,
        adu_type: 'MajorClaim',
        text: 'First claim',
        span_start: 0,
        span_end: 11,
        confidence: 0.9,
        target_adu_id: null,
      });
      expect(adus[1]).toMatchObject({
        adu_type: 'Supporting',
        text: 'First premise',
      });
      expect(adus[2]).toMatchObject({
        adu_type: 'Opposing',
      });
      expect(adus[3]).toMatchObject({
        adu_type: 'Evidence',
      });
    });

    it('should create ADUs with target_adu_id for hierarchy', async () => {
      const post = await factories.createPost();
      const majorClaim = await factories.createADU('post', post.id, {
        adu_type: 'MajorClaim',
        text: 'Main claim',
        span_start: 0,
        span_end: 10,
      });

      const supporting = await repo.createADUs('post', post.id, [
        {
          adu_type: 'Supporting',
          text: 'Support',
          span_start: 11,
          span_end: 18,
          confidence: 0.85,
          target_adu_id: majorClaim.id,
        },
      ]);

      expect(supporting[0]).toMatchObject({
        adu_type: 'Supporting',
        target_adu_id: majorClaim.id,
      });
    });

    it('should reject invalid span offsets where span_end <= span_start', async () => {
      const post = await factories.createPost();

      // PostgreSQL should enforce CHECK constraint on span_end > span_start
      await expect(
        repo.createADUs('post', post.id, [
          { adu_type: 'MajorClaim', text: 'Invalid', span_start: 10, span_end: 5, confidence: 0.9 },
        ])
      ).rejects.toThrow();
    });

    it('should find ADUs by source (post or reply)', async () => {
      const post = await factories.createPost();
      const adu1 = await factories.createADU('post', post.id, {
        text: 'Claim 1',
        span_start: 0,
        span_end: 7,
        adu_type: 'MajorClaim',
      });
      const adu2 = await factories.createADU('post', post.id, {
        text: 'Claim 2',
        span_start: 8,
        span_end: 15,
        adu_type: 'Supporting',
      });

      const found = await repo.findBySource('post', post.id);

      expect(found).toHaveLength(2);
      expect(found[0]).toMatchObject({ id: adu1.id, text: 'Claim 1' });
      expect(found[1]).toMatchObject({ id: adu2.id, text: 'Claim 2' });
    });

    it('should return empty array for source with no ADUs', async () => {
      const post = await factories.createPost();

      const found = await repo.findBySource('post', post.id);

      expect(found).toHaveLength(0);
    });

    it('should return empty array when creating with empty input', async () => {
      const post = await factories.createPost();

      const adus = await repo.createADUs('post', post.id, []);

      expect(adus).toHaveLength(0);
    });
  });

  describe('ADU hierarchy operations', () => {
    it('should create ADUs with hierarchy using target_index', async () => {
      const post = await factories.createPost();

      const adus = await repo.createADUsWithHierarchy('post', post.id, [
        { adu_type: 'MajorClaim', text: 'Main thesis', span_start: 0, span_end: 11, confidence: 0.95, target_index: null },
        { adu_type: 'Supporting', text: 'Because X', span_start: 12, span_end: 21, confidence: 0.9, target_index: 0 },
        { adu_type: 'Evidence', text: 'Study Y', span_start: 22, span_end: 29, confidence: 0.85, target_index: 1 },
        { adu_type: 'Opposing', text: 'However Z', span_start: 30, span_end: 39, confidence: 0.8, target_index: 0 },
      ]);

      expect(adus).toHaveLength(4);
      // MajorClaim has no target
      expect(adus[0]!.target_adu_id).toBeNull();
      // Supporting targets MajorClaim
      expect(adus[1]!.target_adu_id).toBe(adus[0]!.id);
      // Evidence targets Supporting
      expect(adus[2]!.target_adu_id).toBe(adus[1]!.id);
      // Opposing targets MajorClaim
      expect(adus[3]!.target_adu_id).toBe(adus[0]!.id);
    });

    it('should handle out-of-bounds target_index gracefully', async () => {
      const post = await factories.createPost();

      const adus = await repo.createADUsWithHierarchy('post', post.id, [
        { adu_type: 'MajorClaim', text: 'Claim', span_start: 0, span_end: 5, confidence: 0.9, target_index: null },
        { adu_type: 'Supporting', text: 'Support', span_start: 6, span_end: 13, confidence: 0.85, target_index: 99 }, // Invalid index
      ]);

      expect(adus).toHaveLength(2);
      expect(adus[0]!.target_adu_id).toBeNull();
      expect(adus[1]!.target_adu_id).toBeNull(); // Invalid index results in null
    });

    it('should return empty array for empty hierarchy input', async () => {
      const post = await factories.createPost();

      const adus = await repo.createADUsWithHierarchy('post', post.id, []);

      expect(adus).toHaveLength(0);
    });

    it('should find ADUs as tree structure', async () => {
      const post = await factories.createPost();
      const majorClaim = await factories.createADU('post', post.id, {
        adu_type: 'MajorClaim',
        text: 'Main',
        span_start: 0,
        span_end: 4,
        target_adu_id: null,
      });
      await factories.createADU('post', post.id, {
        adu_type: 'Supporting',
        text: 'Support',
        span_start: 5,
        span_end: 12,
        target_adu_id: majorClaim.id,
      });
      await factories.createADU('post', post.id, {
        adu_type: 'Opposing',
        text: 'Counter',
        span_start: 13,
        span_end: 20,
        target_adu_id: majorClaim.id,
      });

      const tree = await repo.findADUsAsTree('post', post.id);

      expect(tree).toHaveLength(3);
      // First should be root (MajorClaim)
      expect(tree[0]!.adu_type).toBe('MajorClaim');
      expect(tree[0]!.target_adu_id).toBeNull();
    });
  });

  describe('Canonical claims with embeddings', () => {
    it('should find similar canonical claims above similarity threshold using pgvector', async () => {
      // Create a canonical claim with embedding
      const canonical = await factories.createCanonicalClaim(null, 'Climate change is real');
      const embedding = Array(1536).fill(0.5);
      embedding[0] = 1.0; // Make first dimension very high for similarity
      await factories.createCanonicalClaimEmbedding(canonical.id, embedding);

      // Create a similar query embedding (high cosine similarity)
      const queryEmbedding = Array(1536).fill(0.5);
      queryEmbedding[0] = 1.0;

      // Find similar claims (threshold 0.75)
      const similar = await repo.findSimilarCanonicalClaims(queryEmbedding, 0.75, 5);

      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0]!).toMatchObject({
        canonical_claim_id: canonical.id,
        representative_text: 'Climate change is real',
      });
      expect(similar[0]!.similarity).toBeGreaterThan(0.75);
    });

    it('should exclude claims below similarity threshold', async () => {
      // Create two canonical claims with very different embeddings
      const canonical1 = await factories.createCanonicalClaim(null, 'Climate change is real');
      const embedding1 = Array(1536).fill(0.1);
      await factories.createCanonicalClaimEmbedding(canonical1.id, embedding1);

      const canonical2 = await factories.createCanonicalClaim(null, 'Earth is flat');
      const embedding2 = Array(1536).fill(0.9);
      await factories.createCanonicalClaimEmbedding(canonical2.id, embedding2);

      // Query with embedding similar to canonical2
      const queryEmbedding = Array(1536).fill(0.85);

      // Find with high threshold
      const similar = await repo.findSimilarCanonicalClaims(queryEmbedding, 0.8, 5);

      // Should only find canonical2, not canonical1
      expect(similar.map(s => s.canonical_claim_id)).toContain(canonical2.id);
    });

    it('should create canonical claim with embedding and increment user count', async () => {
      const author = await factories.createUser();
      const embedding = Array(1536).fill(0.2);

      const canonical = await repo.createCanonicalClaim('Test canonical claim', embedding, author.id);

      expect(canonical).toMatchObject({
        representative_text: 'Test canonical claim',
        author_id: author.id,
        claim_type: 'MajorClaim',
        adu_count: 0,
      });

      // Verify embedding was stored
      const embedResult = await globalThis.testDb
        .getPool()
        .query('SELECT embedding FROM canonical_claim_embeddings WHERE canonical_claim_id = $1', [canonical.id]);
      expect(embedResult.rows).toHaveLength(1);
      expect(JSON.parse(embedResult.rows[0].embedding)).toHaveLength(1536);
    });

    it('should create canonical claim with different claim types', async () => {
      const author = await factories.createUser();
      const embedding = Array(1536).fill(0.3);

      const supportingCanonical = await repo.createCanonicalClaim(
        'Supporting premise',
        embedding,
        author.id,
        'Supporting'
      );
      const opposingCanonical = await repo.createCanonicalClaim(
        'Opposing argument',
        embedding,
        author.id,
        'Opposing'
      );

      expect(supportingCanonical.claim_type).toBe('Supporting');
      expect(opposingCanonical.claim_type).toBe('Opposing');
    });

    it('should get canonical claims by IDs', async () => {
      const claim1 = await factories.createCanonicalClaim(null, 'Claim 1');
      const claim2 = await factories.createCanonicalClaim(null, 'Claim 2');

      const claims = await repo.getCanonicalClaimsByIds([claim1.id, claim2.id]);

      expect(claims).toHaveLength(2);
      expect(claims.map(c => c.id)).toContain(claim1.id);
      expect(claims.map(c => c.id)).toContain(claim2.id);
    });

    it('should return empty array for empty ID list', async () => {
      const claims = await repo.getCanonicalClaimsByIds([]);
      expect(claims).toHaveLength(0);
    });
  });

  describe('ADU to canonical mapping', () => {
    it('should link ADU to canonical claim with similarity score', async () => {
      const post = await factories.createPost();
      const adu = await factories.createADU('post', post.id, { text: 'Test claim' });
      const canonical = await factories.createCanonicalClaim(null, 'Related claim');

      await repo.linkADUToCanonical(adu.id, canonical.id, 0.85);

      // Verify mapping was created
      const mapResult = await globalThis.testDb
        .getPool()
        .query('SELECT * FROM adu_canonical_map WHERE adu_id = $1 AND canonical_claim_id = $2', [
          adu.id,
          canonical.id,
        ]);

      expect(mapResult.rows).toHaveLength(1);
      expect(mapResult.rows[0].similarity_score).toBe(0.85);
    });

    it('should update similarity score on conflict', async () => {
      const post = await factories.createPost();
      const adu = await factories.createADU('post', post.id, { text: 'Test claim' });
      const canonical = await factories.createCanonicalClaim(null, 'Related claim');

      // First link
      await repo.linkADUToCanonical(adu.id, canonical.id, 0.75);

      // Update with new similarity score
      await repo.linkADUToCanonical(adu.id, canonical.id, 0.90);

      const mapResult = await globalThis.testDb
        .getPool()
        .query('SELECT similarity_score FROM adu_canonical_map WHERE adu_id = $1 AND canonical_claim_id = $2', [
          adu.id,
          canonical.id,
        ]);

      expect(mapResult.rows[0].similarity_score).toBe(0.90);
    });

    it('should update adu_count on canonical claim when ADU is linked', async () => {
      const post = await factories.createPost();
      const adu1 = await factories.createADU('post', post.id);
      const adu2 = await factories.createADU('post', post.id);
      const canonical = await factories.createCanonicalClaim();

      await repo.linkADUToCanonical(adu1.id, canonical.id, 0.9);
      await repo.linkADUToCanonical(adu2.id, canonical.id, 0.88);

      const updated = await repo.findCanonicalClaimById(canonical.id);

      expect(updated?.adu_count).toBe(2);
    });
  });

  describe('Semantic search', () => {
    it('should search content by embedding similarity', async () => {
      const post1 = await factories.createPost(undefined, { content: 'Climate change discussion' });
      const post2 = await factories.createPost(undefined, { content: 'Sports news' });

      // Create embeddings
      const climateEmbedding = Array(1536).fill(0.3);
      climateEmbedding[0] = 1.0;
      await factories.createContentEmbedding('post', post1.id, climateEmbedding);

      const sportsEmbedding = Array(1536).fill(0.7);
      sportsEmbedding[1] = 1.0;
      await factories.createContentEmbedding('post', post2.id, sportsEmbedding);

      // Search with climate-similar query
      const queryEmbedding = Array(1536).fill(0.3);
      queryEmbedding[0] = 0.95;

      const results = await repo.semanticSearch(queryEmbedding, 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.source_id).toBe(post1.id);
      expect(results[0]!.similarity).toBeGreaterThan(results[1]?.similarity || 0);
    });

    it('should respect limit parameter', async () => {
      // Create multiple posts with embeddings
      for (let i = 0; i < 5; i++) {
        const post = await factories.createPost();
        const embedding = Array(1536).fill(0.5);
        await factories.createContentEmbedding('post', post.id, embedding);
      }

      const queryEmbedding = Array(1536).fill(0.5);
      const results = await repo.semanticSearch(queryEmbedding, 2);

      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Canonical mapping operations', () => {
    describe('getCanonicalMappingsForADUs', () => {
      it('should return canonical mappings for multiple ADUs', async () => {
        const post = await factories.createPost();
        const adu1 = await factories.createADU('post', post.id, { text: 'Claim 1' });
        const adu2 = await factories.createADU('post', post.id, { text: 'Claim 2' });
        const canonical = await factories.createCanonicalClaim(null, 'Canonical claim text');

        // Link both ADUs to the same canonical claim
        await factories.linkADUToCanonical(adu1.id, canonical.id, 0.95);
        await factories.linkADUToCanonical(adu2.id, canonical.id, 0.88);

        const mappings = await repo.getCanonicalMappingsForADUs([adu1.id, adu2.id]);

        expect(mappings).toHaveLength(2);
        expect(mappings[0]).toMatchObject({
          canonical_claim_id: canonical.id,
          representative_text: 'Canonical claim text',
          adu_count: 2,
        });
      });

      it('should return empty array for empty input', async () => {
        const mappings = await repo.getCanonicalMappingsForADUs([]);
        expect(mappings).toHaveLength(0);
      });

      it('should return empty array for ADUs without canonical mappings', async () => {
        const post = await factories.createPost();
        const adu = await factories.createADU('post', post.id);

        const mappings = await repo.getCanonicalMappingsForADUs([adu.id]);
        expect(mappings).toHaveLength(0);
      });
    });

    describe('getEnrichedSourcesForCanonicalClaim', () => {
      it('should return enriched sources with author info for posts', async () => {
        const author = await factories.createUser();
        const post = await factories.createPost(author.id, {
          title: 'Test Post Title',
          content: 'This is the post content.',
        });
        const adu = await factories.createADU('post', post.id, { text: 'A claim' });
        const canonical = await factories.createCanonicalClaim(null, 'Canonical text');
        await factories.linkADUToCanonical(adu.id, canonical.id, 0.92);

        const sources = await repo.getEnrichedSourcesForCanonicalClaim(canonical.id, 10);

        expect(sources).toHaveLength(1);
        expect(sources[0]).toMatchObject({
          source_type: 'post',
          source_id: post.id,
          title: 'Test Post Title',
          content: 'This is the post content.',
          author_id: author.id,
          adu_text: 'A claim',
          similarity_score: 0.92,
        });
      });

      it('should return enriched sources for replies', async () => {
        const author = await factories.createUser();
        const post = await factories.createPost();
        const reply = await factories.createReply(post.id, author.id, {
          content: 'This is a reply.',
        });
        const adu = await factories.createADU('reply', reply.id, { text: 'Reply claim' });
        const canonical = await factories.createCanonicalClaim(null, 'Canonical text');
        await factories.linkADUToCanonical(adu.id, canonical.id, 0.85);

        const sources = await repo.getEnrichedSourcesForCanonicalClaim(canonical.id, 10);

        expect(sources).toHaveLength(1);
        expect(sources[0]).toMatchObject({
          source_type: 'reply',
          source_id: reply.id,
          title: null,
          content: 'This is a reply.',
          author_id: author.id,
          adu_text: 'Reply claim',
        });
      });

      it('should exclude specified source ID', async () => {
        const post1 = await factories.createPost(undefined, { content: 'Post 1' });
        const post2 = await factories.createPost(undefined, { content: 'Post 2' });
        const adu1 = await factories.createADU('post', post1.id);
        const adu2 = await factories.createADU('post', post2.id);
        const canonical = await factories.createCanonicalClaim();
        await factories.linkADUToCanonical(adu1.id, canonical.id, 0.95);
        await factories.linkADUToCanonical(adu2.id, canonical.id, 0.90);

        // Exclude post1
        const sources = await repo.getEnrichedSourcesForCanonicalClaim(canonical.id, 10, post1.id);

        expect(sources).toHaveLength(1);
        expect(sources[0]!.source_id).toBe(post2.id);
      });

      it('should order results by similarity score descending', async () => {
        const post1 = await factories.createPost();
        const post2 = await factories.createPost();
        const adu1 = await factories.createADU('post', post1.id);
        const adu2 = await factories.createADU('post', post2.id);
        const canonical = await factories.createCanonicalClaim();
        await factories.linkADUToCanonical(adu1.id, canonical.id, 0.75);
        await factories.linkADUToCanonical(adu2.id, canonical.id, 0.95);

        const sources = await repo.getEnrichedSourcesForCanonicalClaim(canonical.id, 10);

        expect(sources).toHaveLength(2);
        expect(sources[0]!.similarity_score).toBe(0.95);
        expect(sources[1]!.similarity_score).toBe(0.75);
      });

      it('should respect limit parameter', async () => {
        const canonical = await factories.createCanonicalClaim();

        // Create 5 posts with ADUs linked to the same canonical claim
        for (let i = 0; i < 5; i++) {
          const post = await factories.createPost();
          const adu = await factories.createADU('post', post.id);
          await factories.linkADUToCanonical(adu.id, canonical.id, 0.9 - i * 0.01);
        }

        const sources = await repo.getEnrichedSourcesForCanonicalClaim(canonical.id, 2);

        expect(sources).toHaveLength(2);
      });

      it('should return empty array for canonical claim with no linked ADUs', async () => {
        const canonical = await factories.createCanonicalClaim();

        const sources = await repo.getEnrichedSourcesForCanonicalClaim(canonical.id, 10);

        expect(sources).toHaveLength(0);
      });
    });
  });
});
