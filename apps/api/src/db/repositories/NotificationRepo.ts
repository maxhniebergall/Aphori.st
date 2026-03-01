import { query } from '../pool.js';
import type { Notification, NotificationWithContext, UnifiedNotification, EpistemicNotificationType, UserType } from '@chitin/shared';

interface NotificationRow {
  id: string;
  user_id: string;
  target_type: 'post' | 'reply';
  target_id: string;
  reply_count: number;
  last_reply_author_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface NotificationWithContextRow extends NotificationRow {
  target_title: string | null;
  target_post_id: string | null;
  target_content_preview: string;
  last_reply_author_display_name: string | null;
  last_reply_author_user_type: UserType | null;
}

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    user_id: row.user_id,
    target_type: row.target_type,
    target_id: row.target_id,
    reply_count: row.reply_count,
    last_reply_author_id: row.last_reply_author_id,
    created_at: (row.created_at as Date).toISOString(),
    updated_at: (row.updated_at as Date).toISOString(),
  };
}

function rowToNotificationWithContext(
  row: NotificationWithContextRow,
  lastViewedAt: string | null
): NotificationWithContext {
  const base = rowToNotification(row);
  return {
    ...base,
    is_new: lastViewedAt ? new Date(base.updated_at) > new Date(lastViewedAt) : true,
    target_title: row.target_title ?? undefined,
    target_post_id: row.target_post_id ?? undefined,
    target_content_preview: row.target_content_preview,
    last_reply_author: row.last_reply_author_id
      ? {
          id: row.last_reply_author_id,
          display_name: row.last_reply_author_display_name ?? null,
          user_type: row.last_reply_author_user_type ?? 'human',
        }
      : null,
  };
}

export const NotificationRepo = {
  async upsert(
    userId: string,
    targetType: 'post' | 'reply',
    targetId: string,
    replyAuthorId: string
  ): Promise<Notification> {
    const result = await query<NotificationRow>(
      `INSERT INTO notifications (user_id, target_type, target_id, reply_count, last_reply_author_id)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (user_id, target_type, target_id)
       DO UPDATE SET
         reply_count = notifications.reply_count + 1,
         last_reply_author_id = $4,
         updated_at = NOW()
       RETURNING *`,
      [userId, targetType, targetId, replyAuthorId]
    );

    return rowToNotification(result.rows[0]!);
  },

  async findByUserId(
    userId: string,
    limit: number = 25,
    cursor?: string,
    lastViewedAt?: string | null
  ): Promise<{ items: UnifiedNotification[]; cursor: string | null; hasMore: boolean }> {
    const params: unknown[] = [userId, limit + 1];
    let cursorClause = '';

    if (cursor) {
      cursorClause = 'AND n.updated_at < $3';
      params.push(cursor);
    }

    const result = await query<NotificationWithContextRow & { category: string; epistemic_type: string | null; payload: Record<string, unknown> | null; is_read: boolean }>(
      `SELECT
        n.*,
        CASE
          WHEN n.target_type = 'post' THEN p.title
          ELSE NULL
        END AS target_title,
        r.post_id AS target_post_id,
        COALESCE(
          CASE
            WHEN n.target_type = 'post' THEN LEFT(p.content, 120)
            ELSE LEFT(r.content, 120)
          END,
          '[deleted]'
        ) AS target_content_preview,
        u.display_name AS last_reply_author_display_name,
        u.user_type AS last_reply_author_user_type
      FROM notifications n
      LEFT JOIN posts p ON n.target_type = 'post' AND n.target_id = p.id AND p.deleted_at IS NULL
      LEFT JOIN replies r ON n.target_type = 'reply' AND n.target_id = r.id AND r.deleted_at IS NULL
      LEFT JOIN users u ON n.last_reply_author_id = u.id AND u.deleted_at IS NULL
      WHERE n.user_id = $1
        ${cursorClause}
      ORDER BY n.updated_at DESC
      LIMIT $2`,
      params
    );

    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const nextCursor = hasMore && rows.length > 0
      ? (rows[rows.length - 1]!.updated_at as Date).toISOString()
      : null;

    const items: UnifiedNotification[] = rows.map(row => {
      if (row.category === 'EPISTEMIC') {
        return {
          category: 'EPISTEMIC' as const,
          id: row.id,
          user_id: row.user_id,
          epistemic_type: row.epistemic_type as EpistemicNotificationType,
          payload: row.payload ?? {},
          is_read: row.is_read,
          created_at: (row.created_at as Date).toISOString(),
          updated_at: (row.updated_at as Date).toISOString(),
        };
      }
      return {
        ...rowToNotificationWithContext(row, lastViewedAt ?? null),
        category: 'SOCIAL' as const,
      };
    });

    return { items, cursor: nextCursor, hasMore };
  },

  async upsertForFollowers(
    authorId: string,
    targetType: 'post' | 'reply',
    targetId: string
  ): Promise<void> {
    await query(
      `INSERT INTO notifications (user_id, target_type, target_id, reply_count, last_reply_author_id)
       SELECT f.follower_id, $2, $3, 1, $1
       FROM follows f
       WHERE f.following_id = $1 AND f.follower_id <> $1
       ON CONFLICT (user_id, target_type, target_id)
       DO UPDATE SET
         reply_count = notifications.reply_count + 1,
         last_reply_author_id = $1,
         updated_at = NOW()`,
      [authorId, targetType, targetId]
    );
  },

  async countNew(userId: string, lastViewedAt: string | null): Promise<number> {
    const [socialResult, epistemicResult] = await Promise.all([
      lastViewedAt
        ? query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM notifications
             WHERE user_id = $1 AND category = 'SOCIAL' AND updated_at > $2`,
            [userId, lastViewedAt]
          )
        : query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND category = 'SOCIAL'`,
            [userId]
          ),
      query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM notifications
         WHERE user_id = $1 AND category = 'EPISTEMIC' AND is_read = FALSE`,
        [userId]
      ),
    ]);
    const social = parseInt(socialResult.rows[0]?.count ?? '0', 10);
    const epistemic = parseInt(epistemicResult.rows[0]?.count ?? '0', 10);
    return social + epistemic;
  },

  async markEpistemicRead(userId: string): Promise<void> {
    await query(
      `UPDATE notifications SET is_read = TRUE
       WHERE user_id = $1 AND category = 'EPISTEMIC' AND is_read = FALSE`,
      [userId]
    );
  },

  async markSingleRead(id: string, userId: string): Promise<boolean> {
    const result = await query(
      `UPDATE notifications SET is_read = TRUE
       WHERE id = $1 AND user_id = $2 AND category = 'EPISTEMIC'`,
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async createEpistemicNotification(
    userId: string,
    type: EpistemicNotificationType,
    payload: Record<string, unknown>
  ): Promise<void> {
    await query(
      `INSERT INTO notifications (user_id, category, epistemic_type, payload, is_read)
       VALUES ($1, 'EPISTEMIC', $2, $3, FALSE)`,
      [userId, type, JSON.stringify(payload)]
    );
  },
};
