import { query } from '../pool.js';
import type { Vote, VoteValue, CreateVoteInput } from '@chitin/shared';

interface VoteRow {
  id: string;
  user_id: string;
  target_type: 'post' | 'reply';
  target_id: string;
  value: number;
  created_at: Date;
  updated_at: Date;
}

function rowToVote(row: VoteRow): Vote {
  return {
    id: row.id,
    user_id: row.user_id,
    target_type: row.target_type,
    target_id: row.target_id,
    value: row.value as VoteValue,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const VoteRepo = {
  async findByUserAndTarget(
    userId: string,
    targetType: 'post' | 'reply',
    targetId: string
  ): Promise<Vote | null> {
    const result = await query<VoteRow>(
      `SELECT * FROM votes
       WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
      [userId, targetType, targetId]
    );
    return result.rows[0] ? rowToVote(result.rows[0]) : null;
  },

  async upsert(userId: string, input: CreateVoteInput): Promise<Vote> {
    // Use upsert to handle both create and update in one query
    const result = await query<VoteRow>(
      `INSERT INTO votes (user_id, target_type, target_id, value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, target_type, target_id)
       DO UPDATE SET value = $4, updated_at = NOW()
       RETURNING *`,
      [userId, input.target_type, input.target_id, input.value]
    );

    return rowToVote(result.rows[0]!);
  },

  async delete(userId: string, targetType: 'post' | 'reply', targetId: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM votes
       WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
      [userId, targetType, targetId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async getVotesForTargets(
    userId: string,
    targetType: 'post' | 'reply',
    targetIds: string[]
  ): Promise<Map<string, VoteValue>> {
    if (targetIds.length === 0) return new Map();

    const result = await query<{ target_id: string; value: number }>(
      `SELECT target_id, value FROM votes
       WHERE user_id = $1 AND target_type = $2 AND target_id = ANY($3)`,
      [userId, targetType, targetIds]
    );

    const voteMap = new Map<string, VoteValue>();
    for (const row of result.rows) {
      voteMap.set(row.target_id, row.value as VoteValue);
    }
    return voteMap;
  },

  async getVoteCountsForTarget(
    targetType: 'post' | 'reply',
    targetId: string
  ): Promise<{ upvotes: number; downvotes: number }> {
    const result = await query<{ upvotes: string; downvotes: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE value = 1) as upvotes,
         COUNT(*) FILTER (WHERE value = -1) as downvotes
       FROM votes
       WHERE target_type = $1 AND target_id = $2`,
      [targetType, targetId]
    );

    return {
      upvotes: parseInt(result.rows[0]?.upvotes ?? '0', 10),
      downvotes: parseInt(result.rows[0]?.downvotes ?? '0', 10),
    };
  },
};
