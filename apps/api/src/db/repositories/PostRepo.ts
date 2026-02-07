import crypto from 'crypto';
import { query } from '../pool.js';
import { config } from '../../config.js';
import type { Post, PostWithAuthor, AnalysisStatus, CreatePostInput, PaginatedResponse, FeedSortType } from '@chitin/shared';

interface PostRow {
  id: string;
  author_id: string;
  title: string;
  content: string;
  analysis_content_hash: string;
  analysis_status: AnalysisStatus;
  score: number;
  vote_count: number;
  reply_count: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface PostWithAuthorRow extends PostRow {
  author_display_name: string | null;
  author_user_type: 'human' | 'agent';
}

function rowToPost(row: PostRow): Post {
  return {
    id: row.id,
    author_id: row.author_id,
    title: row.title,
    content: row.content,
    analysis_content_hash: row.analysis_content_hash,
    analysis_status: row.analysis_status,
    score: row.score,
    reply_count: row.reply_count,
    created_at: (row.created_at as Date).toISOString(),
    updated_at: (row.updated_at as Date).toISOString(),
    deleted_at: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  };
}

function rowToPostWithAuthor(row: PostWithAuthorRow): PostWithAuthor {
  return {
    ...rowToPost(row),
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

export const PostRepo = {
  async findById(id: string): Promise<Post | null> {
    const result = await query<PostRow>(
      'SELECT * FROM posts WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    return result.rows[0] ? rowToPost(result.rows[0]) : null;
  },

  async findByIdWithAuthor(id: string): Promise<PostWithAuthor | null> {
    const result = await query<PostWithAuthorRow>(
      `SELECT p.*, u.display_name as author_display_name, u.user_type as author_user_type
       FROM posts p
       JOIN users u ON p.author_id = u.id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id]
    );
    return result.rows[0] ? rowToPostWithAuthor(result.rows[0]) : null;
  },

  async create(authorId: string, input: CreatePostInput): Promise<Post> {
    const contentHash = generateContentHash(input.content);

    const result = await query<PostRow>(
      `INSERT INTO posts (author_id, title, content, analysis_content_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [authorId, input.title, input.content, contentHash]
    );

    return rowToPost(result.rows[0]!);
  },

  async updateAnalysisStatus(id: string, status: AnalysisStatus): Promise<Post | null> {
    const result = await query<PostRow>(
      `UPDATE posts SET analysis_status = $2
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [id, status]
    );
    return result.rows[0] ? rowToPost(result.rows[0]) : null;
  },

  async softDelete(id: string): Promise<boolean> {
    const result = await query(
      'UPDATE posts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async getFeed(
    sort: FeedSortType,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<PostWithAuthor>> {
    let orderClause: string;
    let cursorCondition = '';
    const params: unknown[] = [limit + 1]; // Fetch one extra to check hasMore

    switch (sort) {
      case 'new':
        orderClause = 'ORDER BY p.created_at DESC';
        if (cursor) {
          cursorCondition = 'AND p.created_at < $2';
          params.push(new Date(cursor));
        }
        break;
      case 'top':
        orderClause = 'ORDER BY p.score DESC, p.created_at DESC';
        if (cursor) {
          const [score, createdAt] = cursor.split('_');
          cursorCondition = 'AND (p.score < $2 OR (p.score = $2 AND p.created_at < $3))';
          params.push(parseInt(score!, 10), new Date(createdAt!));
        }
        break;
      case 'rising':
        // Rising: high vote velocity in recent hours
        // Formula: vote_count / (hours_since_creation + 2)^1.2
        orderClause = `ORDER BY
          (p.vote_count::float / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.2)) DESC,
          p.created_at DESC`;
        // Only include posts from configured window (default 24 hours)
        cursorCondition = `AND p.created_at > NOW() - INTERVAL '${config.feedAlgorithms.rising.windowHours} hours'`;
        if (cursor) {
          cursorCondition += ' AND p.created_at < $2';
          params.push(new Date(cursor));
        }
        break;
      case 'controversial':
        // Controversial: high vote_count, low absolute score
        // Formula: vote_count / (abs(score) + 1)
        orderClause = `ORDER BY
          (p.vote_count::float / (ABS(p.score) + 1)) DESC,
          p.created_at DESC`;
        // Minimum engagement threshold (configurable)
        cursorCondition = `AND p.vote_count >= ${config.feedAlgorithms.controversial.minVotes}`;
        if (cursor) {
          cursorCondition += ' AND p.created_at < $2';
          params.push(new Date(cursor));
        }
        break;
      case 'hot':
      default:
        // Hot ranking: score / (hours + 2)^1.8
        orderClause = `ORDER BY
          (p.score::float / POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 2, 1.8)) DESC,
          p.created_at DESC`;
        if (cursor) {
          // For hot, we use created_at as cursor since ranking changes
          cursorCondition = 'AND p.created_at < $2';
          params.push(new Date(cursor));
        }
        break;
    }

    const result = await query<PostWithAuthorRow>(
      `SELECT p.*, u.display_name as author_display_name, u.user_type as author_user_type
       FROM posts p
       JOIN users u ON p.author_id = u.id
       WHERE p.deleted_at IS NULL ${cursorCondition}
       ${orderClause}
       LIMIT $1`,
      params
    );

    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(rowToPostWithAuthor);

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1]!;
      switch (sort) {
        case 'new':
        case 'hot':
        case 'rising':
        case 'controversial':
          nextCursor = lastItem.created_at;
          break;
        case 'top':
          nextCursor = `${lastItem.score}_${lastItem.created_at}`;
          break;
      }
    }

    return {
      items,
      cursor: nextCursor,
      hasMore,
    };
  },

  async findByAuthor(
    authorId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<PostWithAuthor>> {
    const params: unknown[] = [authorId.toLowerCase(), limit + 1];
    let cursorCondition = '';

    if (cursor) {
      cursorCondition = 'AND p.created_at < $3';
      params.push(new Date(cursor));
    }

    const result = await query<PostWithAuthorRow>(
      `SELECT p.*, u.display_name as author_display_name, u.user_type as author_user_type
       FROM posts p
       JOIN users u ON p.author_id = u.id
       WHERE p.author_id = $1 AND p.deleted_at IS NULL ${cursorCondition}
       ORDER BY p.created_at DESC
       LIMIT $2`,
      params
    );

    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(rowToPostWithAuthor);

    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1]!.created_at
      : null;

    return {
      items,
      cursor: nextCursor,
      hasMore,
    };
  },

  async findByContentHash(hash: string): Promise<Post | null> {
    const result = await query<PostRow>(
      'SELECT * FROM posts WHERE analysis_content_hash = $1 AND deleted_at IS NULL LIMIT 1',
      [hash]
    );
    return result.rows[0] ? rowToPost(result.rows[0]) : null;
  },
};
