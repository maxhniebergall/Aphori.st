import { Pool } from 'pg';

export type ADUType = 'MajorClaim' | 'Supporting' | 'Opposing' | 'Evidence';
export type CanonicalClaimType = 'MajorClaim' | 'Supporting' | 'Opposing';

export interface ADU {
  id: string;
  source_type: 'post' | 'reply';
  source_id: string;
  adu_type: ADUType;
  text: string;
  span_start: number;
  span_end: number;
  confidence: number;
  target_adu_id: string | null;
  created_at: string;
}

export interface CanonicalClaim {
  id: string;
  representative_text: string;
  claim_type: CanonicalClaimType;
  adu_count: number;
  discussion_count: number;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArgumentRelation {
  id: string;
  source_adu_id: string;
  target_adu_id: string;
  relation_type: 'support' | 'attack';
  confidence: number;
  created_at: string;
}

export interface SimilarCanonicalMatch {
  canonical_claim_id: string;
  representative_text: string;
  similarity: number;
}

export interface SearchResult {
  source_type: 'post' | 'reply';
  source_id: string;
  similarity: number;
}

export interface ADUCanonicalMapping {
  adu_id: string;
  canonical_claim_id: string;
  similarity_score: number;
  representative_text: string;
  adu_count: number;
}

export interface EnrichedSource {
  source_type: 'post' | 'reply';
  source_id: string;
  title: string | null;
  content: string;
  author_id: string;
  author_display_name: string | null;
  author_user_type: string;
  created_at: string;
  score: number;
  adu_text: string;
  similarity_score: number;
}

export const createArgumentRepo = (pool: Pool) => ({
  // ADU operations
  async createADUs(
    sourceType: 'post' | 'reply',
    sourceId: string,
    adus: Array<{
      adu_type: ADUType;
      text: string;
      span_start: number;
      span_end: number;
      confidence: number;
      target_adu_id?: string | null;
    }>
  ): Promise<ADU[]> {
    if (adus.length === 0) return [];

    const client = await pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO adus (source_type, source_id, adu_type, text, span_start, span_end, confidence, target_adu_id)
         VALUES ${adus.map((_, i) => `($1, $2, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6}, $${i * 6 + 7}, $${i * 6 + 8})`).join(',')}
         RETURNING *`,
        [sourceType, sourceId, ...adus.flatMap(adu => [
          adu.adu_type,
          adu.text,
          adu.span_start,
          adu.span_end,
          adu.confidence,
          adu.target_adu_id ?? null
        ])]
      );

      return result.rows;
    } finally {
      client.release();
    }
  },

  /**
   * Create ADUs with hierarchy in two passes:
   * 1. First pass: create all ADUs with target_adu_id = null
   * 2. Second pass: update target_adu_id using target_index mapping
   */
  async createADUsWithHierarchy(
    sourceType: 'post' | 'reply',
    sourceId: string,
    adus: Array<{
      adu_type: ADUType;
      text: string;
      span_start: number;
      span_end: number;
      confidence: number;
      target_index: number | null;
    }>
  ): Promise<ADU[]> {
    if (adus.length === 0) return [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // First pass: insert all ADUs without target_adu_id
      const insertResult = await client.query(
        `INSERT INTO adus (source_type, source_id, adu_type, text, span_start, span_end, confidence)
         VALUES ${adus.map((_, i) => `($1, $2, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, $${i * 5 + 6}, $${i * 5 + 7})`).join(',')}
         RETURNING *`,
        [sourceType, sourceId, ...adus.flatMap(adu => [
          adu.adu_type,
          adu.text,
          adu.span_start,
          adu.span_end,
          adu.confidence
        ])]
      );

      const createdADUs: ADU[] = insertResult.rows;

      // Second pass: update target_adu_id for ADUs that have a target_index
      const updates: Array<{ id: string; target_adu_id: string }> = [];
      for (let i = 0; i < adus.length; i++) {
        const targetIndex = adus[i]!.target_index;
        if (targetIndex !== null && targetIndex >= 0 && targetIndex < createdADUs.length) {
          updates.push({
            id: createdADUs[i]!.id,
            target_adu_id: createdADUs[targetIndex]!.id
          });
        }
      }

      if (updates.length > 0) {
        // Batch update using a VALUES clause
        const updateValues = updates
          .map((_, i) => `($${i * 2 + 1}::uuid, $${i * 2 + 2}::uuid)`)
          .join(',');

        await client.query(
          `UPDATE adus AS a
           SET target_adu_id = u.target_adu_id
           FROM (VALUES ${updateValues}) AS u(id, target_adu_id)
           WHERE a.id = u.id`,
          updates.flatMap(u => [u.id, u.target_adu_id])
        );

        // Update the returned ADUs with target_adu_id
        for (const update of updates) {
          const adu = createdADUs.find(a => a.id === update.id);
          if (adu) {
            adu.target_adu_id = update.target_adu_id;
          }
        }
      }

      await client.query('COMMIT');
      return createdADUs;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Find ADUs for a source and build them into a tree structure
   */
  async findADUsAsTree(sourceType: 'post' | 'reply', sourceId: string): Promise<ADU[]> {
    const result = await pool.query(
      `WITH RECURSIVE adu_tree AS (
        -- Base case: root ADUs (MajorClaims with no target)
        SELECT *, 0 as depth
        FROM adus
        WHERE source_type = $1 AND source_id = $2 AND target_adu_id IS NULL

        UNION ALL

        -- Recursive case: ADUs that target other ADUs
        SELECT a.*, t.depth + 1
        FROM adus a
        JOIN adu_tree t ON a.target_adu_id = t.id
        WHERE a.source_type = $1 AND a.source_id = $2
      )
      SELECT * FROM adu_tree ORDER BY depth, span_start`,
      [sourceType, sourceId]
    );
    return result.rows;
  },

  async findBySource(sourceType: 'post' | 'reply', sourceId: string): Promise<ADU[]> {
    const result = await pool.query(
      `SELECT * FROM adus WHERE source_type = $1 AND source_id = $2 ORDER BY span_start ASC`,
      [sourceType, sourceId]
    );
    return result.rows;
  },

  // Embedding operations
  async createADUEmbeddings(
    embeddings: Array<{ adu_id: string; embedding: number[] }>
  ): Promise<void> {
    if (embeddings.length === 0) return;

    const client = await pool.connect();
    try {
      // Batch insert all embeddings in a single query for efficiency
      const values = embeddings
        .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
        .join(',');

      await client.query(
        `INSERT INTO adu_embeddings (adu_id, embedding) VALUES ${values}
         ON CONFLICT (adu_id) DO UPDATE SET embedding = EXCLUDED.embedding`,
        embeddings.flatMap(e => [e.adu_id, JSON.stringify(e.embedding)])
      );
    } finally {
      client.release();
    }
  },

  async createContentEmbedding(
    sourceType: 'post' | 'reply',
    sourceId: string,
    embedding: number[]
  ): Promise<void> {
    await pool.query(
      `INSERT INTO content_embeddings (source_type, source_id, embedding)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_type, source_id) DO UPDATE SET embedding = $3`,
      [sourceType, sourceId, JSON.stringify(embedding)]
    );
  },

  // Canonical claims - RAG-based deduplication
  async findSimilarCanonicalClaims(
    embedding: number[],
    threshold: number = 0.75,
    limit: number = 5
  ): Promise<SimilarCanonicalMatch[]> {
    const result = await pool.query(
      `SELECT
        cce.canonical_claim_id,
        cc.representative_text,
        (1 - (cce.embedding <=> $1::vector)) as similarity
       FROM canonical_claim_embeddings cce
       JOIN canonical_claims cc ON cce.canonical_claim_id = cc.id
       WHERE (1 - (cce.embedding <=> $1::vector)) > $2
       ORDER BY similarity DESC
       LIMIT $3`,
      [JSON.stringify(embedding), threshold, limit]
    );

    return result.rows;
  },

  async getCanonicalClaimsByIds(ids: string[]): Promise<CanonicalClaim[]> {
    if (ids.length === 0) return [];

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT * FROM canonical_claims WHERE id IN (${placeholders})`,
      ids
    );

    return result.rows;
  },

  async createCanonicalClaim(
    text: string,
    embedding: number[],
    authorId: string | null,
    claimType: CanonicalClaimType = 'MajorClaim'
  ): Promise<CanonicalClaim> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const claimResult = await client.query(
        `INSERT INTO canonical_claims (representative_text, author_id, claim_type)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [text, authorId, claimType]
      );

      const claim = claimResult.rows[0];

      await client.query(
        `INSERT INTO canonical_claim_embeddings (canonical_claim_id, embedding)
         VALUES ($1, $2)`,
        [claim.id, JSON.stringify(embedding)]
      );

      await client.query('COMMIT');

      return claim;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async linkADUToCanonical(
    aduId: string,
    canonicalId: string,
    similarity: number
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert or update the mapping
      await client.query(
        `INSERT INTO adu_canonical_map (adu_id, canonical_claim_id, similarity_score)
         VALUES ($1, $2, $3)
         ON CONFLICT (adu_id, canonical_claim_id) DO UPDATE SET similarity_score = $3`,
        [aduId, canonicalId, similarity]
      );

      // Update ADU count and discussion count on canonical claim (atomic with insert)
      await client.query(
        `UPDATE canonical_claims
         SET adu_count = (SELECT COUNT(*) FROM adu_canonical_map WHERE canonical_claim_id = $1),
             discussion_count = (
               SELECT COUNT(DISTINCT
                 CASE WHEN a.source_type = 'post' THEN a.source_id
                      WHEN a.source_type = 'reply' THEN r.post_id
                 END
               )
               FROM adu_canonical_map acm
               JOIN adus a ON acm.adu_id = a.id
               LEFT JOIN replies r ON a.source_type = 'reply' AND a.source_id = r.id
               WHERE acm.canonical_claim_id = $1
             )
         WHERE id = $1`,
        [canonicalId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async findCanonicalClaimById(id: string): Promise<CanonicalClaim | null> {
    const result = await pool.query(
      `SELECT * FROM canonical_claims WHERE id = $1`,
      [id]
    );

    return result.rows[0] || null;
  },

  // Argument relations
  async createRelations(
    relations: Array<{ source_adu_id: string; target_adu_id: string; relation_type: 'support' | 'attack'; confidence: number }>
  ): Promise<void> {
    if (relations.length === 0) return;

    const client = await pool.connect();
    try {
      // Batch insert all relations in a single query for efficiency
      // NOTE: Current UNIQUE constraint is (source_adu_id, target_adu_id, relation_type).
      // When support for both 'support' AND 'attack' relations between the same ADU pair is added,
      // this constraint should be updated to (source_adu_id, target_adu_id) to allow multiple relation types.
      const values = relations
        .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
        .join(',');

      await client.query(
        `INSERT INTO argument_relations (source_adu_id, target_adu_id, relation_type, confidence)
         VALUES ${values}
         ON CONFLICT (source_adu_id, target_adu_id, relation_type) DO UPDATE SET confidence = EXCLUDED.confidence`,
        relations.flatMap(r => [r.source_adu_id, r.target_adu_id, r.relation_type, r.confidence])
      );
    } finally {
      client.release();
    }
  },

  async findRelationsByADU(aduId: string): Promise<ArgumentRelation[]> {
    const result = await pool.query(
      `SELECT * FROM argument_relations
       WHERE source_adu_id = $1 OR target_adu_id = $1
       ORDER BY confidence DESC`,
      [aduId]
    );

    return result.rows;
  },

  // Semantic search with optional similarity threshold
  async semanticSearch(
    queryEmbedding: number[],
    limit: number = 20,
    threshold: number = 0.5
  ): Promise<SearchResult[]> {
    const result = await pool.query(
      `SELECT
        source_type,
        source_id,
        (1 - (embedding <=> $1::vector)) as similarity
       FROM content_embeddings
       WHERE (1 - (embedding <=> $1::vector)) > $2
       ORDER BY similarity DESC
       LIMIT $3`,
      [JSON.stringify(queryEmbedding), threshold, limit]
    );

    return result.rows;
  },

  // Canonical mapping operations for deduplication UI
  async getCanonicalMappingsForADUs(aduIds: string[]): Promise<ADUCanonicalMapping[]> {
    if (aduIds.length === 0) return [];

    const placeholders = aduIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT
        acm.adu_id,
        acm.canonical_claim_id,
        acm.similarity_score,
        cc.representative_text,
        cc.adu_count
       FROM adu_canonical_map acm
       JOIN canonical_claims cc ON acm.canonical_claim_id = cc.id
       WHERE acm.adu_id IN (${placeholders})`,
      aduIds
    );

    return result.rows;
  },

  async getEnrichedSourcesForCanonicalClaim(
    canonicalClaimId: string,
    limit: number = 10,
    excludeSourceId?: string
  ): Promise<EnrichedSource[]> {
    const result = await pool.query(
      `WITH linked_adus AS (
        SELECT
          a.id AS adu_id,
          a.source_type,
          a.source_id,
          a.text AS adu_text,
          acm.similarity_score
        FROM adu_canonical_map acm
        JOIN adus a ON acm.adu_id = a.id
        WHERE acm.canonical_claim_id = $1
      )
      SELECT
        la.source_type,
        la.source_id,
        CASE
          WHEN la.source_type = 'post' THEN p.title
          ELSE NULL
        END AS title,
        CASE
          WHEN la.source_type = 'post' THEN p.content
          ELSE r.content
        END AS content,
        u.id AS author_id,
        u.display_name AS author_display_name,
        u.user_type AS author_user_type,
        CASE
          WHEN la.source_type = 'post' THEN p.created_at
          ELSE r.created_at
        END AS created_at,
        CASE
          WHEN la.source_type = 'post' THEN p.score
          ELSE r.score
        END AS score,
        la.adu_text,
        la.similarity_score
      FROM linked_adus la
      LEFT JOIN posts p ON la.source_type = 'post' AND la.source_id = p.id AND p.deleted_at IS NULL
      LEFT JOIN replies r ON la.source_type = 'reply' AND la.source_id = r.id AND r.deleted_at IS NULL
      LEFT JOIN users u ON u.id = CASE
        WHEN la.source_type = 'post' THEN p.author_id
        ELSE r.author_id
      END
      WHERE (p.id IS NOT NULL OR r.id IS NOT NULL)
        AND ($2::uuid IS NULL OR la.source_id != $2)
      ORDER BY score DESC, la.similarity_score DESC
      LIMIT $3`,
      [canonicalClaimId, excludeSourceId || null, limit]
    );

    return result.rows;
  },
});

export type ArgumentRepo = ReturnType<typeof createArgumentRepo>;
