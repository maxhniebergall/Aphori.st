import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { Pool } from 'pg';
import type { ADU, CanonicalClaim, ADUType, CanonicalClaimType } from '../../db/repositories/ArgumentRepo.js';

export class TestFactories {
  constructor(private pool: Pool) {}

  async createUser(overrides?: Partial<any>): Promise<any> {
    const userId = overrides?.id || `testuser_${uuidv4().substring(0, 8)}`;
    const userData = {
      id: userId,
      email: `test_${uuidv4().substring(0, 8)}@example.com`,
      user_type: 'human',
      display_name: `Test User ${userId.substring(0, 8)}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };

    const result = await this.pool.query(
      `INSERT INTO users (id, email, user_type, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userData.id, userData.email, userData.user_type, userData.display_name, userData.created_at, userData.updated_at]
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
    const title = overrides?.title || 'Test Post Title';
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const postData = {
      id: postId,
      author_id: author,
      title,
      content,
      analysis_content_hash: contentHash,
      analysis_status: 'pending',
      score: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };

    const result = await this.pool.query(
      `INSERT INTO posts (id, author_id, title, content, analysis_content_hash, analysis_status, score, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        postData.id,
        postData.author_id,
        postData.title,
        postData.content,
        postData.analysis_content_hash,
        postData.analysis_status,
        postData.score,
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
    // Generate a path for ltree - just use the reply ID with dots replaced by underscores
    const pathId = replyId.replace(/-/g, '_');

    const replyData = {
      id: replyId,
      post_id: post,
      author_id: author,
      content,
      analysis_content_hash: contentHash,
      analysis_status: 'pending',
      depth: 0,
      path: pathId,
      score: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };

    const result = await this.pool.query(
      `INSERT INTO replies (id, post_id, author_id, content, analysis_content_hash, analysis_status, depth, path, score, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        replyData.id,
        replyData.post_id,
        replyData.author_id,
        replyData.content,
        replyData.analysis_content_hash,
        replyData.analysis_status,
        replyData.depth,
        replyData.path,
        replyData.score,
        replyData.created_at,
        replyData.updated_at,
      ]
    );

    return result.rows[0];
  }

  async createADU(
    sourceType: 'post' | 'reply',
    sourceId: string,
    overrides?: Partial<ADU & { adu_type: ADUType }>
  ): Promise<ADU> {
    const aduId = uuidv4();
    const aduData = {
      id: aduId,
      source_type: sourceType,
      source_id: sourceId,
      adu_type: overrides?.adu_type || 'MajorClaim' as ADUType,
      text: overrides?.text || 'This is a test claim.',
      span_start: overrides?.span_start ?? 0,
      span_end: overrides?.span_end ?? 25,
      confidence: overrides?.confidence ?? 0.95,
      target_adu_id: overrides?.target_adu_id ?? null,
      created_at: new Date().toISOString(),
      ...overrides,
    };

    const result = await this.pool.query(
      `INSERT INTO adus (id, source_type, source_id, adu_type, text, span_start, span_end, confidence, target_adu_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        aduData.id,
        aduData.source_type,
        aduData.source_id,
        aduData.adu_type,
        aduData.text,
        aduData.span_start,
        aduData.span_end,
        aduData.confidence,
        aduData.target_adu_id,
        aduData.created_at,
      ]
    );

    return result.rows[0];
  }

  async createADUEmbedding(aduId: string, embedding?: number[]): Promise<void> {
    const vector = embedding || Array(1536).fill(0.1);

    await this.pool.query(
      `INSERT INTO adu_embeddings (adu_id, embedding) VALUES ($1, $2)
       ON CONFLICT (adu_id) DO UPDATE SET embedding = $2`,
      [aduId, JSON.stringify(vector)]
    );
  }

  async createCanonicalClaim(
    authorId?: string | null,
    text?: string,
    claimType: CanonicalClaimType = 'MajorClaim'
  ): Promise<CanonicalClaim> {
    const claimId = uuidv4();
    const author = authorId || null;
    const claimText = text || 'This is a canonical claim.';

    const result = await this.pool.query(
      `INSERT INTO canonical_claims (id, representative_text, author_id, claim_type, adu_count, discussion_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, 0, $5, $6) RETURNING *`,
      [claimId, claimText, author, claimType, new Date().toISOString(), new Date().toISOString()]
    );

    return result.rows[0];
  }

  async createCanonicalClaimEmbedding(canonicalId: string, embedding?: number[]): Promise<void> {
    const vector = embedding || Array(1536).fill(0.1);

    await this.pool.query(
      `INSERT INTO canonical_claim_embeddings (canonical_claim_id, embedding) VALUES ($1, $2)
       ON CONFLICT (canonical_claim_id) DO UPDATE SET embedding = $2`,
      [canonicalId, JSON.stringify(vector)]
    );
  }

  async createContentEmbedding(sourceType: 'post' | 'reply', sourceId: string, embedding?: number[]): Promise<void> {
    const vector = embedding || Array(1536).fill(0.15);

    await this.pool.query(
      `INSERT INTO content_embeddings (source_type, source_id, embedding)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_type, source_id) DO UPDATE SET embedding = $3`,
      [sourceType, sourceId, JSON.stringify(vector)]
    );
  }

  async createVote(
    userId: string,
    targetType: 'post' | 'reply',
    targetId: string,
    value: 1 | -1 = 1
  ): Promise<any> {
    const result = await this.pool.query(
      `INSERT INTO votes (user_id, target_type, target_id, value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, target_type, target_id)
       DO UPDATE SET value = $4, updated_at = NOW()
       RETURNING *`,
      [userId, targetType, targetId, value]
    );
    return result.rows[0];
  }

  async createNotification(
    userId: string,
    targetType: 'post' | 'reply',
    targetId: string,
    replyAuthorId: string,
    overrides?: Partial<any>
  ): Promise<any> {
    const result = await this.pool.query(
      `INSERT INTO notifications (user_id, target_type, target_id, reply_count, last_reply_author_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, target_type, target_id)
       DO UPDATE SET
         reply_count = notifications.reply_count + 1,
         last_reply_author_id = $5,
         updated_at = NOW()
       RETURNING *`,
      [userId, targetType, targetId, overrides?.reply_count ?? 1, replyAuthorId]
    );
    return result.rows[0];
  }

  async createFollow(followerId: string, followingId: string): Promise<any> {
    const result = await this.pool.query(
      `INSERT INTO follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [followerId, followingId]
    );
    // If conflict (already exists), fetch the existing row
    if (!result.rows[0]) {
      const existing = await this.pool.query(
        `SELECT * FROM follows WHERE follower_id = $1 AND following_id = $2`,
        [followerId, followingId]
      );
      return existing.rows[0];
    }
    return result.rows[0];
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

  async linkADUToCanonical(
    aduId: string,
    canonicalId: string,
    similarityScore: number = 0.9
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO adu_canonical_map (adu_id, canonical_claim_id, similarity_score)
       VALUES ($1, $2, $3)
       ON CONFLICT (adu_id, canonical_claim_id) DO UPDATE SET similarity_score = $3`,
      [aduId, canonicalId, similarityScore]
    );

    // Update adu_count on canonical claim
    await this.pool.query(
      `UPDATE canonical_claims
       SET adu_count = (SELECT COUNT(*) FROM adu_canonical_map WHERE canonical_claim_id = $1)
       WHERE id = $1`,
      [canonicalId]
    );
  }
}

export function createFactories(pool: Pool): TestFactories {
  return new TestFactories(pool);
}
