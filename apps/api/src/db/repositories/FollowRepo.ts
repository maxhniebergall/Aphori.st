import { query } from '../pool.js';
import type { User, PaginatedResponse } from '@chitin/shared';

type FollowUser = Pick<User, 'id' | 'display_name' | 'user_type'>;

interface FollowUserRow {
  id: string;
  display_name: string | null;
  user_type: 'human' | 'agent';
  created_at: Date; // follow created_at for cursor pagination
}

export const FollowRepo = {
  async follow(followerId: string, followingId: string): Promise<boolean> {
    const result = await query(
      `INSERT INTO follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [followerId.toLowerCase(), followingId.toLowerCase()]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async unfollow(followerId: string, followingId: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM follows WHERE follower_id = $1 AND following_id = $2`,
      [followerId.toLowerCase(), followingId.toLowerCase()]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const result = await query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2
      ) AS exists`,
      [followerId.toLowerCase(), followingId.toLowerCase()]
    );
    return result.rows[0]?.exists ?? false;
  },

  async getFollowers(
    userId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<FollowUser>> {
    const normalizedUserId = userId.toLowerCase();
    const params: unknown[] = [normalizedUserId, limit + 1];
    let cursorCondition = '';

    if (cursor) {
      cursorCondition = 'AND f.created_at < $3';
      params.push(new Date(cursor));
    }

    const result = await query<FollowUserRow>(
      `SELECT u.id, u.display_name, u.user_type, f.created_at
       FROM follows f
       JOIN users u ON f.follower_id = u.id
       WHERE f.following_id = $1 AND u.deleted_at IS NULL ${cursorCondition}
       ORDER BY f.created_at DESC
       LIMIT $2`,
      params
    );

    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const items: FollowUser[] = rows.map(r => ({
      id: r.id,
      display_name: r.display_name,
      user_type: r.user_type,
    }));

    const nextCursor = hasMore && rows.length > 0
      ? (rows[rows.length - 1]!.created_at as Date).toISOString()
      : null;

    return { items, cursor: nextCursor, hasMore };
  },

  async getFollowing(
    userId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<FollowUser>> {
    const normalizedUserId = userId.toLowerCase();
    const params: unknown[] = [normalizedUserId, limit + 1];
    let cursorCondition = '';

    if (cursor) {
      cursorCondition = 'AND f.created_at < $3';
      params.push(new Date(cursor));
    }

    const result = await query<FollowUserRow>(
      `SELECT u.id, u.display_name, u.user_type, f.created_at
       FROM follows f
       JOIN users u ON f.following_id = u.id
       WHERE f.follower_id = $1 AND u.deleted_at IS NULL ${cursorCondition}
       ORDER BY f.created_at DESC
       LIMIT $2`,
      params
    );

    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const items: FollowUser[] = rows.map(r => ({
      id: r.id,
      display_name: r.display_name,
      user_type: r.user_type,
    }));

    const nextCursor = hasMore && rows.length > 0
      ? (rows[rows.length - 1]!.created_at as Date).toISOString()
      : null;

    return { items, cursor: nextCursor, hasMore };
  },

};
