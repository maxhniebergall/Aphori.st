import crypto from 'crypto';
import { query, withTransaction } from '../pool.js';
import type { Reply, ReplyWithAuthor, CreateReplyInput, PaginatedResponse } from '@chitin/shared';
import { AppError } from '../../middleware/errorHandler.js';

interface ReplyRow {
  id: string;
  post_id: string;
  author_id: string;
  parent_reply_id: string | null;
  target_adu_id: string | null;
  content: string;
  analysis_content_hash: string;
  depth: number;
  path: string;
  score: number;
  reply_count: number;
  quoted_text: string | null;
  quoted_source_type: 'post' | 'reply' | null;
  quoted_source_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface ReplyWithAuthorRow extends ReplyRow {
  author_display_name: string | null;
  author_user_type: 'human' | 'agent';
}

function rowToReply(row: ReplyRow): Reply {
  return {
    id: row.id,
    post_id: row.post_id,
    author_id: row.author_id,
    parent_reply_id: row.parent_reply_id,
    target_adu_id: row.target_adu_id,
    content: row.content,
    analysis_content_hash: row.analysis_content_hash,
    depth: row.depth,
    path: row.path,
    score: row.score,
    reply_count: row.reply_count,
    quoted_text: row.quoted_text,
    quoted_source_type: row.quoted_source_type,
    quoted_source_id: row.quoted_source_id,
    created_at: (row.created_at as Date).toISOString(),
    updated_at: (row.updated_at as Date).toISOString(),
    deleted_at: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  };
}

function rowToReplyWithAuthor(row: ReplyWithAuthorRow): ReplyWithAuthor {
  return {
    ...rowToReply(row),
    author: {
      id: row.author_id,
      display_name: row.author_display_name,
      user_type: row.author_user_type,
    },
  };
}

function generateContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export const ReplyRepo = {
  async findById(id: string): Promise<Reply | null> {
    const result = await query<ReplyRow>(
      'SELECT * FROM replies WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    return result.rows[0] ? rowToReply(result.rows[0]) : null;
  },

  async findByIdWithAuthor(id: string): Promise<ReplyWithAuthor | null> {
    const result = await query<ReplyWithAuthorRow>(
      `SELECT r.*, u.display_name as author_display_name, u.user_type as author_user_type
       FROM replies r
       JOIN users u ON r.author_id = u.id
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [id]
    );
    return result.rows[0] ? rowToReplyWithAuthor(result.rows[0]) : null;
  },

  async create(
    postId: string,
    authorId: string,
    input: CreateReplyInput
  ): Promise<Reply> {
    const contentHash = generateContentHash(input.content);

    return withTransaction(async (client) => {
      let depth = 0;
      let path: string;

      if (input.parent_reply_id) {
        // Get parent reply info for path and depth
        const parentResult = await client.query<{ depth: number; path: string; id: string }>(
          'SELECT depth, path, id FROM replies WHERE id = $1 AND deleted_at IS NULL',
          [input.parent_reply_id]
        );

        if (!parentResult.rows[0]) {
          throw new Error('Parent reply not found');
        }

        depth = parentResult.rows[0].depth + 1;
        // Path will be set after we have the new reply ID
      }

      // Insert the reply (path will be updated after)
      const result = await client.query<ReplyRow>(
        `INSERT INTO replies (post_id, author_id, parent_reply_id, target_adu_id, content, analysis_content_hash, depth, path, quoted_text, quoted_source_type, quoted_source_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, '', $8, $9, $10)
         RETURNING *`,
        [
          postId,
          authorId,
          input.parent_reply_id ?? null,
          input.target_adu_id ?? null,
          input.content,
          contentHash,
          depth,
          input.quoted_text ?? null,
          input.quoted_source_type ?? null,
          input.quoted_source_id ?? null,
        ]
      );

      const newReply = result.rows[0]!;

      // Build the ltree path
      if (input.parent_reply_id) {
        const parentResult = await client.query<{ path: string }>(
          'SELECT path FROM replies WHERE id = $1',
          [input.parent_reply_id]
        );
        const parentPath = parentResult.rows[0]!.path;
        // Use reply ID without dashes for ltree compatibility
        const replyIdLabel = newReply.id.replace(/-/g, '_');
        path = parentPath ? `${parentPath}.${replyIdLabel}` : replyIdLabel;
      } else {
        path = newReply.id.replace(/-/g, '_');
      }

      // Update the path
      await client.query(
        'UPDATE replies SET path = $2 WHERE id = $1',
        [newReply.id, path]
      );

      return rowToReply({ ...newReply, path });
    });
  },

  async findByAuthor(
    authorId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<ReplyWithAuthor>> {
    const params: unknown[] = [authorId.toLowerCase(), limit + 1];
    let cursorCondition = '';

    if (cursor) {
      cursorCondition = 'AND r.created_at < $3';
      params.push(cursor);
    }

    const result = await query<ReplyWithAuthorRow>(
      `SELECT r.*, u.display_name as author_display_name, u.user_type as author_user_type
       FROM replies r
       JOIN users u ON r.author_id = u.id
       WHERE r.author_id = $1 AND r.deleted_at IS NULL ${cursorCondition}
       ORDER BY r.created_at DESC
       LIMIT $2`,
      params
    );

    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(rowToReplyWithAuthor);

    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1]!.created_at
      : null;

    return {
      items,
      cursor: nextCursor,
      hasMore,
    };
  },

  async findByPostId(
    postId: string,
    limit: number,
    cursor?: string,
    sort: 'top' | 'new' | 'controversial' = 'new'
  ): Promise<PaginatedResponse<ReplyWithAuthor>> {
    const params: unknown[] = [postId, limit + 1];
    let cursorCondition = '';

    // Keyset cursor encodes all sort columns as JSON to avoid row skips/duplication
    // across pages when ordering on multi-column keys.
    if (cursor) {
      let decoded: Record<string, unknown>;
      try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as Record<string, unknown>;
        if (!decoded || typeof decoded !== 'object') throw new Error('invalid shape');
      } catch {
        throw new AppError(400, 'INVALID_CURSOR', 'Malformed pagination cursor');
      }
      switch (sort) {
        case 'top':
          cursorCondition = 'AND (r.score < $3 OR (r.score = $3 AND r.created_at < $4) OR (r.score = $3 AND r.created_at = $4 AND r.id < $5))';
          params.push(decoded.score, decoded.created_at, decoded.id);
          break;
        case 'controversial':
          cursorCondition = 'AND (r.vote_count < $3 OR (r.vote_count = $3 AND ABS(r.score) > $4) OR (r.vote_count = $3 AND ABS(r.score) = $4 AND r.created_at < $5) OR (r.vote_count = $3 AND ABS(r.score) = $4 AND r.created_at = $5 AND r.id < $6))';
          params.push(decoded.vote_count, decoded.abs_score, decoded.created_at, decoded.id);
          break;
        case 'new':
        default:
          cursorCondition = 'AND (r.created_at < $3 OR (r.created_at = $3 AND r.id < $4))';
          params.push(decoded.created_at, decoded.id);
          break;
      }
    }

    let orderBy: string;
    switch (sort) {
      case 'top':
        orderBy = 'r.score DESC, r.created_at DESC, r.id DESC';
        break;
      case 'controversial':
        orderBy = 'r.vote_count DESC, ABS(r.score) ASC, r.created_at DESC, r.id DESC';
        break;
      case 'new':
      default:
        orderBy = 'r.created_at DESC, r.id DESC';
        break;
    }

    const result = await query<ReplyWithAuthorRow>(
      `SELECT r.*, u.display_name as author_display_name, u.user_type as author_user_type
       FROM replies r
       JOIN users u ON r.author_id = u.id
       WHERE r.post_id = $1 AND r.deleted_at IS NULL ${cursorCondition}
       ORDER BY ${orderBy}
       LIMIT $2`,
      params
    );

    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(rowToReplyWithAuthor);

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1]!;
      let payload: Record<string, unknown>;
      switch (sort) {
        case 'top':
          payload = { score: last.score, created_at: last.created_at, id: last.id };
          break;
        case 'controversial':
          payload = { vote_count: (last as ReplyWithAuthor & { vote_count?: number }).vote_count ?? 0, abs_score: Math.abs(last.score), created_at: last.created_at, id: last.id };
          break;
        default:
          payload = { created_at: last.created_at, id: last.id };
          break;
      }
      nextCursor = Buffer.from(JSON.stringify(payload)).toString('base64');
    }

    return {
      items,
      cursor: nextCursor,
      hasMore,
    };
  },

  async findByParentReplyId(
    parentReplyId: string,
    limit: number,
    cursor?: string,
    // 'evidence' is handled upstream by syntheticThreadService; falls back to score ordering.
    sort: 'top' | 'new' | 'controversial' | 'evidence' = 'top'
  ): Promise<PaginatedResponse<ReplyWithAuthor>> {
    const params: unknown[] = [parentReplyId, limit + 1];
    let cursorCondition = '';

    if (cursor) {
      let decoded: Record<string, unknown>;
      try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as Record<string, unknown>;
        if (!decoded || typeof decoded !== 'object') throw new Error('invalid shape');
      } catch {
        throw new AppError(400, 'INVALID_CURSOR', 'Malformed pagination cursor');
      }
      switch (sort) {
        case 'top':
        case 'evidence':
          cursorCondition = 'AND (r.score < $3 OR (r.score = $3 AND r.created_at < $4) OR (r.score = $3 AND r.created_at = $4 AND r.id < $5))';
          params.push(decoded.score, decoded.created_at, decoded.id);
          break;
        case 'controversial':
          cursorCondition = 'AND (r.vote_count < $3 OR (r.vote_count = $3 AND ABS(r.score) > $4) OR (r.vote_count = $3 AND ABS(r.score) = $4 AND r.created_at < $5) OR (r.vote_count = $3 AND ABS(r.score) = $4 AND r.created_at = $5 AND r.id < $6))';
          params.push(decoded.vote_count, decoded.abs_score, decoded.created_at, decoded.id);
          break;
        case 'new':
        default:
          cursorCondition = 'AND (r.created_at < $3 OR (r.created_at = $3 AND r.id < $4))';
          params.push(decoded.created_at, decoded.id);
          break;
      }
    }

    let orderBy: string;
    switch (sort) {
      case 'new':
        orderBy = 'r.created_at DESC, r.id DESC';
        break;
      case 'controversial':
        orderBy = 'r.vote_count DESC, ABS(r.score) ASC, r.created_at DESC, r.id DESC';
        break;
      case 'top':
      case 'evidence':
      default:
        orderBy = 'r.score DESC, r.created_at DESC, r.id DESC';
        break;
    }

    const result = await query<ReplyWithAuthorRow>(
      `SELECT r.*, u.display_name as author_display_name, u.user_type as author_user_type
       FROM replies r
       JOIN users u ON r.author_id = u.id
       WHERE r.parent_reply_id = $1 AND r.deleted_at IS NULL ${cursorCondition}
       ORDER BY ${orderBy}
       LIMIT $2`,
      params
    );

    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(rowToReplyWithAuthor);

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1]!;
      let payload: Record<string, unknown>;
      switch (sort) {
        case 'controversial':
          payload = { vote_count: (last as ReplyWithAuthor & { vote_count?: number }).vote_count ?? 0, abs_score: Math.abs(last.score), created_at: last.created_at, id: last.id };
          break;
        case 'new':
          payload = { created_at: last.created_at, id: last.id };
          break;
        default:
          payload = { score: last.score, created_at: last.created_at, id: last.id };
          break;
      }
      nextCursor = Buffer.from(JSON.stringify(payload)).toString('base64');
    }

    return {
      items,
      cursor: nextCursor,
      hasMore,
    };
  },

  async findThreadedByPostId(postId: string): Promise<ReplyWithAuthor[]> {
    const result = await query<ReplyWithAuthorRow>(
      `SELECT r.*, u.display_name as author_display_name, u.user_type as author_user_type
       FROM replies r
       JOIN users u ON r.author_id = u.id
       WHERE r.post_id = $1 AND r.deleted_at IS NULL
       ORDER BY r.path ASC`,
      [postId]
    );

    return result.rows.map(rowToReplyWithAuthor);
  },

  async findByTargetADU(aduId: string, limit: number): Promise<ReplyWithAuthor[]> {
    const result = await query<ReplyWithAuthorRow>(
      `SELECT r.*, u.display_name as author_display_name, u.user_type as author_user_type
       FROM replies r
       JOIN users u ON r.author_id = u.id
       WHERE r.target_adu_id = $1 AND r.deleted_at IS NULL
       ORDER BY r.score DESC, r.created_at ASC
       LIMIT $2`,
      [aduId, limit]
    );

    return result.rows.map(rowToReplyWithAuthor);
  },

  async findByIds(ids: string[]): Promise<Map<string, ReplyWithAuthor>> {
    if (ids.length === 0) return new Map();
    const result = await query<ReplyWithAuthorRow>(
      `SELECT r.*, u.display_name AS author_display_name, u.user_type AS author_user_type
       FROM replies r
       JOIN users u ON r.author_id = u.id
       WHERE r.id = ANY($1) AND r.deleted_at IS NULL`,
      [ids]
    );
    const map = new Map<string, ReplyWithAuthor>();
    for (const row of result.rows) {
      map.set(row.id, rowToReplyWithAuthor(row));
    }
    return map;
  },

  async softDelete(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE replies SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  },
};
