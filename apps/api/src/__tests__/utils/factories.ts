import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { Pool } from 'pg';
import type { ADU, CanonicalClaim } from '../../db/repositories/ArgumentRepo.js';

export class TestFactories {
  constructor(private pool: Pool) {}

  async createUser(overrides?: Partial<any>): Promise<any> {
    const userId = uuidv4();
    const userData = {
      id: userId,
      username: `testuser_${userId.substring(0, 8)}`,
      email: `test_${userId.substring(0, 8)}@example.com`,
      password_hash: 'hashed_password',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };

    const result = await this.pool.query(
      `INSERT INTO users (id, username, email, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userData.id, userData.username, userData.email, userData.password_hash, userData.created_at, userData.updated_at]
    );

    return result.rows[0];
  }

  async createPost(
    authorId?: string,
    overrides?: Partial<any>
  ): Promise<any> {
    const author = authorId || (await this.createUser()).id;
    const postId = uuidv4();
    const content = overrides?.content || 'This is a test post with claims and premises.';
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const postData = {
      id: postId,
      author_id: author,
      content,
      analysis_content_hash: contentHash,
      analysis_status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };

    const result = await this.pool.query(
      `INSERT INTO posts (id, author_id, content, analysis_content_hash, analysis_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        postData.id,
        postData.author_id,
        postData.content,
        postData.analysis_content_hash,
        postData.analysis_status,
        postData.created_at,
        postData.updated_at,
      ]
    );

    return result.rows[0];
  }

  async createReply(postId?: string, authorId?: string, overrides?: Partial<any>): Promise<any> {
    const post = postId || (await this.createPost()).id;
    const author = authorId || (await this.createUser()).id;
    const replyId = uuidv4();
    const content = overrides?.content || 'This is a reply to the post.';
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const replyData = {
      id: replyId,
      post_id: post,
      author_id: author,
      content,
      analysis_content_hash: contentHash,
      analysis_status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };

    const result = await this.pool.query(
      `INSERT INTO replies (id, post_id, author_id, content, analysis_content_hash, analysis_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        replyData.id,
        replyData.post_id,
        replyData.author_id,
        replyData.content,
        replyData.analysis_content_hash,
        replyData.analysis_status,
        replyData.created_at,
        replyData.updated_at,
      ]
    );

    return result.rows[0];
  }

  async createADU(
    sourceType: 'post' | 'reply',
    sourceId: string,
    overrides?: Partial<any>
  ): Promise<ADU> {
    const aduId = uuidv4();
    const aduData = {
      id: aduId,
      source_type: sourceType,
      source_id: sourceId,
      adu_type: overrides?.adu_type || 'claim',
      text: overrides?.text || 'This is a test claim.',
      span_start: overrides?.span_start ?? 0,
      span_end: overrides?.span_end ?? 25,
      confidence: overrides?.confidence ?? 0.95,
      created_at: new Date().toISOString(),
      ...overrides,
    };

    const result = await this.pool.query(
      `INSERT INTO adus (id, source_type, source_id, adu_type, text, span_start, span_end, confidence, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        aduData.id,
        aduData.source_type,
        aduData.source_id,
        aduData.adu_type,
        aduData.text,
        aduData.span_start,
        aduData.span_end,
        aduData.confidence,
        aduData.created_at,
      ]
    );

    return result.rows[0];
  }

  async createADUEmbedding(aduId: string, embedding?: number[]): Promise<void> {
    const vector = embedding || Array(768).fill(0.1);

    await this.pool.query(
      `INSERT INTO adu_embeddings (adu_id, embedding) VALUES ($1, $2)
       ON CONFLICT (adu_id) DO UPDATE SET embedding = $2`,
      [aduId, JSON.stringify(vector)]
    );
  }

  async createCanonicalClaim(authorId?: string, text?: string): Promise<CanonicalClaim> {
    const claimId = uuidv4();
    const author = authorId || null;
    const claimText = text || 'This is a canonical claim.';

    const result = await this.pool.query(
      `INSERT INTO canonical_claims (id, representative_text, author_id, adu_count, discussion_count, created_at, updated_at)
       VALUES ($1, $2, $3, 0, 0, $4, $5) RETURNING *`,
      [claimId, claimText, author, new Date().toISOString(), new Date().toISOString()]
    );

    return result.rows[0];
  }

  async createCanonicalClaimEmbedding(canonicalId: string, embedding?: number[]): Promise<void> {
    const vector = embedding || Array(768).fill(0.1);

    await this.pool.query(
      `INSERT INTO canonical_claim_embeddings (canonical_claim_id, embedding) VALUES ($1, $2)
       ON CONFLICT (canonical_claim_id) DO UPDATE SET embedding = $2`,
      [canonicalId, JSON.stringify(vector)]
    );
  }

  async createContentEmbedding(sourceType: 'post' | 'reply', sourceId: string, embedding?: number[]): Promise<void> {
    const vector = embedding || Array(768).fill(0.15);

    await this.pool.query(
      `INSERT INTO content_embeddings (source_type, source_id, embedding)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_type, source_id) DO UPDATE SET embedding = $3`,
      [sourceType, sourceId, JSON.stringify(vector)]
    );
  }

  async createArgumentRelation(
    sourceAduId: string,
    targetAduId: string,
    relationType: 'support' | 'attack' = 'support',
    confidence: number = 0.9
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO argument_relations (source_adu_id, target_adu_id, relation_type, confidence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_adu_id, target_adu_id, relation_type) DO UPDATE SET confidence = $4`,
      [sourceAduId, targetAduId, relationType, confidence]
    );
  }
}

export function createFactories(pool: Pool): TestFactories {
  return new TestFactories(pool);
}
