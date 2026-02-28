import { Pool } from 'pg';
import type {
  V3UserKarmaProfile,
  EpistemicNotificationType,
  V3EscrowStatus,
  V3Source,
  V3KarmaNode,
  V3ActiveBounty,
} from '@chitin/shared';

// ── Types for batch graph processing ──

export interface INodeGraphData {
  id: string;
  content: string;
  epistemic_type: string;
  fact_subtype: string | null;
  base_weight: number;
  evidence_rank: number;
  is_defeated: boolean;
  component_id: string | null;
  node_role: string | null;
  source_type: 'post' | 'reply';
  source_id: string;
  source_ref_id: string | null;
  vote_score: number;
  author_id: string | null;
}

export interface SNodeGraphData {
  id: string;
  direction: 'SUPPORT' | 'ATTACK';
  escrow_expires_at: string | null;
  pending_bounty: number | null;
  escrow_status: string;
}

export interface EdgeGraphData {
  id: string;
  scheme_node_id: string;
  node_id: string | null;
  source_id: string | null;
  node_type: string;
  role: string;
}

export interface ERUpdate {
  id: string;
  evidence_rank: number;
  is_defeated: boolean;
}

export interface ComponentUpdate {
  id: string;
  component_id: string;
}

export interface KarmaIncrement {
  userId: string;
  pioneer: number;
  builder: number;
  critic: number;
}

export interface KarmaYields {
  pioneer: number;
  builder: number;
  critic: number;
}

export const createV3GamificationRepo = (pool: Pool) => ({

  // ── Graph Loading (for nightly batch) ──

  async loadAllINodes(): Promise<INodeGraphData[]> {
    const result = await pool.query(`
      SELECT
        ni.id,
        ni.content,
        ni.epistemic_type,
        ni.fact_subtype,
        ni.base_weight,
        ni.evidence_rank,
        ni.is_defeated,
        ni.component_id,
        ni.node_role,
        ni.source_type,
        ni.source_id,
        ni.source_ref_id,
        COALESCE(
          CASE WHEN ni.source_type = 'post' THEN p.score ELSE r.score END,
          0
        ) as vote_score,
        CASE WHEN ni.source_type = 'post' THEN p.author_id ELSE r.author_id END as author_id
      FROM v3_nodes_i ni
      LEFT JOIN posts p ON ni.source_type = 'post' AND p.id = ni.source_id AND p.deleted_at IS NULL
      LEFT JOIN replies r ON ni.source_type = 'reply' AND r.id = ni.source_id AND r.deleted_at IS NULL
    `);
    return result.rows.map((r: Record<string, unknown>) => ({
      ...r,
      base_weight: parseFloat(r.base_weight as string) || 1.0,
      evidence_rank: parseFloat(r.evidence_rank as string) || 0.0,
      vote_score: parseInt(r.vote_score as string, 10) || 0,
    })) as INodeGraphData[];
  },

  async loadAllSNodes(): Promise<SNodeGraphData[]> {
    const result = await pool.query(`
      SELECT id, direction, escrow_expires_at, pending_bounty, escrow_status
      FROM v3_nodes_s
    `);
    return result.rows as SNodeGraphData[];
  },

  async loadAllEdges(): Promise<EdgeGraphData[]> {
    const result = await pool.query(`
      SELECT id, scheme_node_id, node_id, source_id, node_type, role
      FROM v3_edges
    `);
    return result.rows as EdgeGraphData[];
  },

  // ── EvidenceRank Batch Updates ──

  async batchUpdateEvidenceRanks(updates: ERUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const ids = updates.map(u => u.id);
    const ranks = updates.map(u => u.evidence_rank);
    const defeated = updates.map(u => u.is_defeated);

    await pool.query(`
      UPDATE v3_nodes_i AS ni
      SET
        evidence_rank = data.evidence_rank,
        is_defeated = data.is_defeated
      FROM (
        SELECT
          unnest($1::uuid[]) as id,
          unnest($2::float[]) as evidence_rank,
          unnest($3::boolean[]) as is_defeated
      ) as data
      WHERE ni.id = data.id
    `, [ids, ranks, defeated]);
  },

  // ── Component ID Batch Updates ──

  async batchUpdateComponentIds(updates: ComponentUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const ids = updates.map(u => u.id);
    const componentIds = updates.map(u => u.component_id);

    await pool.query(`
      UPDATE v3_nodes_i AS ni
      SET component_id = data.component_id
      FROM (
        SELECT
          unnest($1::uuid[]) as id,
          unnest($2::uuid[]) as component_id
      ) as data
      WHERE ni.id = data.id
    `, [ids, componentIds]);
  },

  // ── Get previous defeat state (to detect flips) ──

  async getDefeatedNodeIds(): Promise<Set<string>> {
    const result = await pool.query(`
      SELECT id FROM v3_nodes_i WHERE is_defeated = TRUE
    `);
    return new Set(result.rows.map((r: { id: string }) => r.id));
  },

  // ── Karma Profiles ──

  async upsertKarmaProfile(userId: string, yields: KarmaYields): Promise<void> {
    await pool.query(`
      INSERT INTO v3_user_karma_profiles (user_id, daily_pioneer_yield, daily_builder_yield, daily_critic_yield, last_batch_run_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        daily_pioneer_yield = EXCLUDED.daily_pioneer_yield,
        daily_builder_yield = EXCLUDED.daily_builder_yield,
        daily_critic_yield = EXCLUDED.daily_critic_yield,
        last_batch_run_at = NOW(),
        updated_at = NOW()
    `, [userId, yields.pioneer, yields.builder, yields.critic]);
  },

  async batchIncrementUserKarma(updates: KarmaIncrement[]): Promise<void> {
    if (updates.length === 0) return;
    const userIds = updates.map(u => u.userId);
    const pioneers = updates.map(u => u.pioneer);
    const builders = updates.map(u => u.builder);
    const critics = updates.map(u => u.critic);

    await pool.query(`
      UPDATE users AS u
      SET
        pioneer_karma = u.pioneer_karma + data.pioneer,
        builder_karma = u.builder_karma + data.builder,
        critic_karma = u.critic_karma + data.critic
      FROM (
        SELECT
          unnest($1::text[]) as user_id,
          unnest($2::float[]) as pioneer,
          unnest($3::float[]) as builder,
          unnest($4::float[]) as critic
      ) as data
      WHERE u.id = data.user_id AND u.deleted_at IS NULL
    `, [userIds, pioneers, builders, critics]);
  },

  // ── Epistemic Notifications ──

  async createEpistemicNotification(
    userId: string,
    type: EpistemicNotificationType,
    payload: Record<string, unknown>
  ): Promise<void> {
    await pool.query(`
      INSERT INTO notifications (user_id, category, epistemic_type, payload, is_read)
      VALUES ($1, 'EPISTEMIC', $2, $3, FALSE)
    `, [userId, type, JSON.stringify(payload)]);
  },

  // ── Karma Profile Query ──

  async getKarmaProfile(userId: string): Promise<V3UserKarmaProfile | null> {
    const result = await pool.query(`
      SELECT
        u.id as user_id,
        COALESCE(kp.daily_pioneer_yield, 0) as daily_pioneer_yield,
        COALESCE(kp.daily_builder_yield, 0) as daily_builder_yield,
        COALESCE(kp.daily_critic_yield, 0) as daily_critic_yield,
        kp.last_batch_run_at,
        COALESCE(kp.updated_at, u.updated_at) as updated_at,
        COALESCE(u.pioneer_karma, 0) as pioneer_karma,
        COALESCE(u.builder_karma, 0) as builder_karma,
        COALESCE(u.critic_karma, 0) as critic_karma
      FROM users u
      LEFT JOIN v3_user_karma_profiles kp ON kp.user_id = u.id
      WHERE u.id = $1 AND u.deleted_at IS NULL
    `, [userId]);
    if (!result.rows[0]) return null;
    const r = result.rows[0] as Record<string, unknown>;
    return {
      user_id: r.user_id as string,
      daily_pioneer_yield: parseFloat(r.daily_pioneer_yield as string),
      daily_builder_yield: parseFloat(r.daily_builder_yield as string),
      daily_critic_yield: parseFloat(r.daily_critic_yield as string),
      last_batch_run_at: r.last_batch_run_at as string | null,
      updated_at: r.updated_at as string,
      pioneer_karma: parseFloat(r.pioneer_karma as string),
      builder_karma: parseFloat(r.builder_karma as string),
      critic_karma: parseFloat(r.critic_karma as string),
    };
  },

  // ── Karma Nodes (yielding I-nodes by role) ──

  async getKarmaNodes(userId: string): Promise<V3KarmaNode[]> {
    const result = await pool.query(`
      SELECT
        ni.id,
        ni.content,
        ni.rewritten_text,
        ni.epistemic_type,
        ni.node_role,
        ni.base_weight,
        ni.evidence_rank,
        ni.is_defeated,
        ni.source_type,
        ni.source_id
      FROM v3_nodes_i ni
      LEFT JOIN posts p ON ni.source_type = 'post' AND p.id = ni.source_id
      LEFT JOIN replies r ON ni.source_type = 'reply' AND r.id = ni.source_id
      WHERE
        (
          (ni.source_type = 'post' AND p.author_id = $1 AND p.deleted_at IS NULL)
          OR
          (ni.source_type = 'reply' AND r.author_id = $1 AND r.deleted_at IS NULL)
        )
        AND ni.node_role IS NOT NULL
      ORDER BY ni.node_role, ni.evidence_rank DESC
    `, [userId]);
    return result.rows.map((r: Record<string, unknown>) => ({
      ...r,
      base_weight: parseFloat(r.base_weight as string) || 1.0,
      evidence_rank: parseFloat(r.evidence_rank as string) || 0.0,
    })) as V3KarmaNode[];
  },

  // ── Bounties ──

  async getPendingBounties(limit: number = 20, offset: number = 0): Promise<{ bounties: V3ActiveBounty[]; total: number }> {
    const [dataResult, countResult] = await Promise.all([
      pool.query(`
        SELECT
          s.id as scheme_node_id,
          s.pending_bounty,
          s.escrow_expires_at,
          s.escrow_status,
          (
            SELECT ni.content FROM v3_edges e
            JOIN v3_nodes_i ni ON ni.id = e.node_id
            WHERE e.scheme_node_id = s.id AND e.role = 'premise' AND e.node_type = 'i_node'
            LIMIT 1
          ) as component_a_sample,
          (
            SELECT ni.content FROM v3_edges e
            JOIN v3_nodes_i ni ON ni.id = e.node_id
            WHERE e.scheme_node_id = s.id AND e.role = 'conclusion' AND e.node_type = 'i_node'
            LIMIT 1
          ) as component_b_sample
        FROM v3_nodes_s s
        WHERE s.escrow_status = 'active' AND s.escrow_expires_at > NOW()
        ORDER BY s.pending_bounty DESC, s.escrow_expires_at ASC
        LIMIT $1 OFFSET $2
      `, [limit, offset]),
      pool.query(`
        SELECT COUNT(*) as total FROM v3_nodes_s
        WHERE escrow_status = 'active' AND escrow_expires_at > NOW()
      `),
    ]);
    return {
      bounties: dataResult.rows.map((r: Record<string, unknown>) => ({
        scheme_node_id: r.scheme_node_id as string,
        pending_bounty: parseInt(r.pending_bounty as string, 10) || 0,
        escrow_expires_at: r.escrow_expires_at as string,
        escrow_status: r.escrow_status as V3EscrowStatus,
        component_a_sample: r.component_a_sample as string | null,
        component_b_sample: r.component_b_sample as string | null,
      })),
      total: parseInt(countResult.rows[0].total as string, 10),
    };
  },

  async getExpiredEscrows(): Promise<Array<{
    id: string;
    pending_bounty: number;
    is_defeated: boolean;
    evidence_rank: number;
    author_id: string | null;
    attacking_author_id: string | null;
  }>> {
    const result = await pool.query(`
      SELECT
        s.id,
        s.pending_bounty,
        COALESCE(ni.is_defeated, FALSE) as is_defeated,
        COALESCE(ni.evidence_rank, 0) as evidence_rank,
        CASE WHEN ni.source_type = 'post' THEN p.author_id ELSE r.author_id END as author_id,
        (
          SELECT CASE WHEN ni2.source_type = 'post' THEN p2.author_id ELSE r2.author_id END
          FROM v3_edges e2
          JOIN v3_nodes_i ni2 ON ni2.id = e2.node_id
          LEFT JOIN posts p2 ON ni2.source_type = 'post' AND p2.id = ni2.source_id
          LEFT JOIN replies r2 ON ni2.source_type = 'reply' AND r2.id = ni2.source_id
          JOIN v3_nodes_s s2 ON s2.id = e2.scheme_node_id
          WHERE s2.direction = 'ATTACK'
            AND e2.role = 'premise'
            AND EXISTS (
              SELECT 1 FROM v3_edges e3
              WHERE e3.scheme_node_id = s2.id AND e3.role = 'conclusion' AND e3.node_id = ni.id
            )
          ORDER BY ni2.created_at DESC
          LIMIT 1
        ) as attacking_author_id
      FROM v3_nodes_s s
      JOIN v3_edges e ON e.scheme_node_id = s.id AND e.role = 'conclusion' AND e.node_type = 'i_node'
      JOIN v3_nodes_i ni ON ni.id = e.node_id
      LEFT JOIN posts p ON ni.source_type = 'post' AND p.id = ni.source_id
      LEFT JOIN replies r ON ni.source_type = 'reply' AND r.id = ni.source_id
      WHERE s.escrow_status = 'active' AND s.escrow_expires_at < NOW()
    `);
    return result.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      pending_bounty: parseInt(r.pending_bounty as string, 10) || 0,
      is_defeated: r.is_defeated as boolean,
      evidence_rank: parseFloat(r.evidence_rank as string) || 0,
      author_id: r.author_id as string | null,
      attacking_author_id: r.attacking_author_id as string | null,
    }));
  },

  async updateEscrowStatus(schemeNodeId: string, status: 'paid' | 'stolen' | 'languished'): Promise<void> {
    await pool.query(`
      UPDATE v3_nodes_s SET escrow_status = $2 WHERE id = $1
    `, [schemeNodeId, status]);
  },

  async setEscrow(schemeNodeId: string, pendingBounty: number, expiresAt: Date): Promise<void> {
    await pool.query(`
      UPDATE v3_nodes_s
      SET escrow_status = 'active', pending_bounty = $2, escrow_expires_at = $3
      WHERE id = $1 AND escrow_status = 'none'
    `, [schemeNodeId, pendingBounty, expiresAt]);
  },

  // ── Source (R-Node) Operations ──

  async upsertSource(url: string, level: string = 'DOMAIN', title?: string): Promise<V3Source> {
    const result = await pool.query(`
      INSERT INTO v3_sources (level, url, title)
      VALUES ($1, $2, $3)
      ON CONFLICT (url) DO UPDATE SET
        title = COALESCE(EXCLUDED.title, v3_sources.title),
        updated_at = NOW()
      RETURNING id, level, url, title, parent_source_id, reputation_score, created_at, updated_at
    `, [level, url, title ?? null]);
    return result.rows[0] as V3Source;
  },

  async batchUpdateSourceReputation(updates: Array<{ id: string; score: number }>): Promise<void> {
    if (updates.length === 0) return;
    const ids = updates.map(u => u.id);
    const scores = updates.map(u => u.score);
    await pool.query(`
      UPDATE v3_sources AS vs
      SET reputation_score = data.score, updated_at = NOW()
      FROM (
        SELECT unnest($1::uuid[]) as id, unnest($2::float[]) as score
      ) as data
      WHERE vs.id = data.id
    `, [ids, scores]);
  },

  async getSourcesWithCitations(): Promise<Array<{
    id: string;
    url: string;
    reputation_score: number;
    total_er: number;
    survived_er: number;
  }>> {
    const result = await pool.query(`
      SELECT
        vs.id,
        vs.url,
        vs.reputation_score,
        COALESCE(SUM(ni.evidence_rank), 0) as total_er,
        COALESCE(SUM(ni.evidence_rank) FILTER (WHERE ni.is_defeated = FALSE), 0) as survived_er
      FROM v3_sources vs
      JOIN v3_nodes_i ni ON ni.source_ref_id = vs.id AND ni.epistemic_type = 'FACT'
      GROUP BY vs.id, vs.url, vs.reputation_score
      HAVING COUNT(ni.id) > 0
    `);
    return result.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      url: r.url as string,
      reputation_score: parseFloat(r.reputation_score as string),
      total_er: parseFloat(r.total_er as string) || 0,
      survived_er: parseFloat(r.survived_er as string) || 0,
    }));
  },

  // ── Upstream dependency tracking (for UPSTREAM_DEFEATED notifications) ──

  async getUpstreamDependents(iNodeIds: string[]): Promise<Array<{
    upstream_node_id: string;
    upstream_author_id: string | null;
    defeated_premise_id: string;
  }>> {
    if (iNodeIds.length === 0) return [];
    const result = await pool.query(`
      SELECT DISTINCT
        e_conc.node_id as upstream_node_id,
        CASE WHEN ni_up.source_type = 'post' THEN p.author_id ELSE r.author_id END as upstream_author_id,
        e_prem.node_id as defeated_premise_id
      FROM v3_edges e_prem
      JOIN v3_nodes_s s ON s.id = e_prem.scheme_node_id AND s.direction = 'SUPPORT'
      JOIN v3_edges e_conc ON e_conc.scheme_node_id = s.id AND e_conc.role = 'conclusion' AND e_conc.node_type = 'i_node'
      JOIN v3_nodes_i ni_up ON ni_up.id = e_conc.node_id
      LEFT JOIN posts p ON ni_up.source_type = 'post' AND p.id = ni_up.source_id
      LEFT JOIN replies r ON ni_up.source_type = 'reply' AND r.id = ni_up.source_id
      WHERE e_prem.role = 'premise' AND e_prem.node_type = 'i_node'
        AND e_prem.node_id = ANY($1::uuid[])
    `, [iNodeIds]);
    return result.rows as Array<{
      upstream_node_id: string;
      upstream_author_id: string | null;
      defeated_premise_id: string;
    }>;
  },

  async getINodeAuthor(iNodeId: string): Promise<string | null> {
    const result = await pool.query(`
      SELECT
        CASE WHEN ni.source_type = 'post' THEN p.author_id ELSE r.author_id END as author_id
      FROM v3_nodes_i ni
      LEFT JOIN posts p ON ni.source_type = 'post' AND p.id = ni.source_id
      LEFT JOIN replies r ON ni.source_type = 'reply' AND r.id = ni.source_id
      WHERE ni.id = $1
    `, [iNodeId]);
    return (result.rows[0]?.author_id as string | undefined) ?? null;
  },

  async setBridgeMetadata(schemeNodeId: string, componentAId: string, componentBId: string): Promise<void> {
    await pool.query(
      `UPDATE v3_nodes_s SET is_bridge = TRUE, component_a_id = $2, component_b_id = $3 WHERE id = $1`,
      [schemeNodeId, componentAId, componentBId]
    );
  },

  async batchUpdateINodeBaseWeights(updates: Array<{ id: string; base_weight: number }>): Promise<void> {
    if (updates.length === 0) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const update of updates) {
        await client.query(
          'UPDATE v3_nodes_i SET base_weight = $1 WHERE id = $2',
          [update.base_weight, update.id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
});

export type V3GamificationRepo = ReturnType<typeof createV3GamificationRepo>;
