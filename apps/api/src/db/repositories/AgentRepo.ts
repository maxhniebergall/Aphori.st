import { query } from '../pool.js';
import type { AgentIdentity, AgentToken } from '@chitin/shared';

interface AgentIdentityRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  model_info: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface AgentTokenRow {
  id: string;
  agent_id: string;
  jti: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

function rowToAgentIdentity(row: AgentIdentityRow): AgentIdentity {
  return {
    id: row.id,
    owner_id: row.owner_id,
    name: row.name,
    description: row.description,
    model_info: row.model_info,
    created_at: (row.created_at as Date).toISOString(),
    updated_at: (row.updated_at as Date).toISOString(),
    deleted_at: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  };
}

function rowToAgentToken(row: AgentTokenRow): AgentToken {
  return {
    id: row.id,
    agent_id: row.agent_id,
    jti: row.jti,
    expires_at: (row.expires_at as Date).toISOString(),
    revoked_at: row.revoked_at ? (row.revoked_at as Date).toISOString() : null,
    created_at: (row.created_at as Date).toISOString(),
  };
}

export const AgentRepo = {
  /**
   * Find agent identity by ID
   */
  async findById(id: string): Promise<AgentIdentity | null> {
    const result = await query<AgentIdentityRow>(
      'SELECT * FROM agent_identities WHERE id = $1 AND deleted_at IS NULL',
      [id.toLowerCase()]
    );
    return result.rows[0] ? rowToAgentIdentity(result.rows[0]) : null;
  },

  /**
   * List all agents owned by a user
   */
  async findByOwner(ownerId: string): Promise<AgentIdentity[]> {
    const result = await query<AgentIdentityRow>(
      `SELECT * FROM agent_identities
       WHERE owner_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [ownerId.toLowerCase()]
    );
    return result.rows.map(rowToAgentIdentity);
  },

  /**
   * Count agents owned by a user
   */
  async countByOwner(ownerId: string): Promise<number> {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_identities
       WHERE owner_id = $1 AND deleted_at IS NULL`,
      [ownerId.toLowerCase()]
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  },

  /**
   * Create a new agent identity
   */
  async create(
    id: string,
    ownerId: string,
    name: string,
    description?: string,
    modelInfo?: string,
  ): Promise<AgentIdentity> {
    const result = await query<AgentIdentityRow>(
      `INSERT INTO agent_identities (id, owner_id, name, description, model_info)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id.toLowerCase(), ownerId.toLowerCase(), name, description ?? null, modelInfo ?? null]
    );
    return rowToAgentIdentity(result.rows[0]!);
  },

  /**
   * Update agent identity
   */
  async update(
    id: string,
    updates: {
      name?: string;
      description?: string;
      model_info?: string;
    }
  ): Promise<AgentIdentity | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramCount++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramCount++}`);
      values.push(updates.description ?? null);
    }
    if (updates.model_info !== undefined) {
      fields.push(`model_info = $${paramCount++}`);
      values.push(updates.model_info ?? null);
    }
    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id.toLowerCase());

    const result = await query<AgentIdentityRow>(
      `UPDATE agent_identities
       SET ${fields.join(', ')}
       WHERE id = $${paramCount} AND deleted_at IS NULL
       RETURNING *`,
      values
    );
    return result.rows[0] ? rowToAgentIdentity(result.rows[0]) : null;
  },

  /**
   * Soft delete an agent
   */
  async softDelete(id: string): Promise<boolean> {
    const result = await query(
      `UPDATE agent_identities
       SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [id.toLowerCase()]
    );
    return (result.rowCount ?? 0) > 0;
  },

  // Token management methods

  /**
   * Create a new agent token
   */
  async createToken(
    agentId: string,
    jti: string,
    expiresAt: Date
  ): Promise<AgentToken> {
    const result = await query<AgentTokenRow>(
      `INSERT INTO agent_tokens (agent_id, jti, expires_at)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [agentId.toLowerCase(), jti, expiresAt]
    );
    return rowToAgentToken(result.rows[0]!);
  },

  /**
   * Find token by JTI
   */
  async findTokenByJti(jti: string): Promise<AgentToken | null> {
    const result = await query<AgentTokenRow>(
      'SELECT * FROM agent_tokens WHERE jti = $1',
      [jti]
    );
    return result.rows[0] ? rowToAgentToken(result.rows[0]) : null;
  },

  /**
   * Check if token is valid (not revoked and not expired)
   */
  async isTokenValid(jti: string): Promise<boolean> {
    const result = await query<{ is_valid: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM agent_tokens
         WHERE jti = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ) as is_valid`,
      [jti]
    );
    return result.rows[0]?.is_valid ?? false;
  },

  /**
   * Revoke a specific token by JTI
   */
  async revokeTokenByJti(jti: string): Promise<boolean> {
    const result = await query(
      `UPDATE agent_tokens
       SET revoked_at = NOW()
       WHERE jti = $1 AND revoked_at IS NULL`,
      [jti]
    );
    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Revoke all tokens for an agent
   */
  async revokeAllTokens(agentId: string): Promise<number> {
    const result = await query(
      `UPDATE agent_tokens
       SET revoked_at = NOW()
       WHERE agent_id = $1 AND revoked_at IS NULL`,
      [agentId.toLowerCase()]
    );
    return result.rowCount ?? 0;
  },

  /**
   * Get aggregate activity counts for owner across all their agents
   * Used for per-owner rate limiting
   */
  async getOwnerActivityCounts(
    ownerId: string,
    windowStart: Date
  ): Promise<{ posts: number; replies: number; votes: number }> {
    const result = await query<{
      posts: number;
      replies: number;
      votes: number;
    }>(
      `WITH owner_agents AS (
         SELECT id FROM agent_identities
         WHERE owner_id = $1 AND deleted_at IS NULL
       ),
       post_counts AS (
         SELECT COUNT(*)::int as count FROM posts
         WHERE author_id IN (SELECT id FROM owner_agents) AND created_at > $2
       ),
       reply_counts AS (
         SELECT COUNT(*)::int as count FROM replies
         WHERE author_id IN (SELECT id FROM owner_agents) AND created_at > $2
       ),
       vote_counts AS (
         SELECT COUNT(*)::int as count FROM votes
         WHERE user_id IN (SELECT id FROM owner_agents) AND created_at > $2
       )
       SELECT
         COALESCE((SELECT count FROM post_counts), 0) as posts,
         COALESCE((SELECT count FROM reply_counts), 0) as replies,
         COALESCE((SELECT count FROM vote_counts), 0) as votes`,
      [ownerId.toLowerCase(), windowStart]
    );

    return {
      posts: result.rows[0]?.posts ?? 0,
      replies: result.rows[0]?.replies ?? 0,
      votes: result.rows[0]?.votes ?? 0,
    };
  },
};
