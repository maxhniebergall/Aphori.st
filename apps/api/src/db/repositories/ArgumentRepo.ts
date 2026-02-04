import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';

export interface ADU {
  id: string;
  source_type: 'post' | 'reply';
  source_id: string;
  adu_type: 'claim' | 'premise';
  text: string;
  span_start: number;
  span_end: number;
  confidence: number;
  created_at: string;
}

export interface CanonicalClaim {
  id: string;
  representative_text: string;
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

export const createArgumentRepo = (pool: Pool) => ({
  // ADU operations
  async createADUs(
    sourceType: 'post' | 'reply',
    sourceId: string,
    adus: Array<{ adu_type: 'claim' | 'premise'; text: string; span_start: number; span_end: number; confidence: number }>
  ): Promise<ADU[]> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO adus (source_type, source_id, adu_type, text, span_start, span_end, confidence)
         VALUES ${adus.map((_, i) => `($1, $2, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5}, $${i * 5 + 6}, $${i * 5 + 7})`).join(',')}
         RETURNING *`,
        adus.flatMap((adu, i) => [sourceType, sourceId, adu.adu_type, adu.text, adu.span_start, adu.span_end, adu.confidence])
      );

      return result.rows;
    } finally {
      client.release();
    }
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
    const client = await pool.connect();
    try {
      for (const emb of embeddings) {
        await client.query(
          `INSERT INTO adu_embeddings (adu_id, embedding) VALUES ($1, $2)`,
          [emb.adu_id, JSON.stringify(emb.embedding)]
        );
      }
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
    authorId: string | null
  ): Promise<CanonicalClaim> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const claimResult = await client.query(
        `INSERT INTO canonical_claims (representative_text, author_id)
         VALUES ($1, $2)
         RETURNING *`,
        [text, authorId]
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
      await client.query(
        `INSERT INTO adu_canonical_map (adu_id, canonical_claim_id, similarity_score)
         VALUES ($1, $2, $3)
         ON CONFLICT (adu_id, canonical_claim_id) DO UPDATE SET similarity_score = $3`,
        [aduId, canonicalId, similarity]
      );

      // Update ADU count on canonical claim
      await client.query(
        `UPDATE canonical_claims
         SET adu_count = (SELECT COUNT(*) FROM adu_canonical_map WHERE canonical_claim_id = $1)
         WHERE id = $1`,
        [canonicalId]
      );
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
      for (const rel of relations) {
        await client.query(
          `INSERT INTO argument_relations (source_adu_id, target_adu_id, relation_type, confidence)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (source_adu_id, target_adu_id, relation_type) DO UPDATE SET confidence = $4`,
          [rel.source_adu_id, rel.target_adu_id, rel.relation_type, rel.confidence]
        );
      }
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

  // Semantic search
  async semanticSearch(queryEmbedding: number[], limit: number = 20): Promise<SearchResult[]> {
    const result = await pool.query(
      `SELECT
        source_type,
        source_id,
        (1 - (embedding <=> $1::vector)) as similarity
       FROM content_embeddings
       ORDER BY similarity DESC
       LIMIT $2`,
      [JSON.stringify(queryEmbedding), limit]
    );

    return result.rows;
  },
});

export type ArgumentRepo = ReturnType<typeof createArgumentRepo>;
