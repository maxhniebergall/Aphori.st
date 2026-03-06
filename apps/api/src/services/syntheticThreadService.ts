import { getPool } from '../db/pool.js';
import { createV3HypergraphRepo } from '../db/repositories/V3HypergraphRepo.js';
import { ReplyRepo } from '../db/repositories/ReplyRepo.js';
import type { SyntheticReplyWithAuthor, SyntheticThreadResponse, ReplyWithAuthor } from '@chitin/shared';

interface CandidateRow {
  reply_id: string;
  i_node_id: string;
  parent_adu_id: string;
  direction: string;
  evidence_rank: number;
  degree_centrality: number;
  wb_score: number;
}

interface ScoredCandidate {
  reply_id: string;
  targeted_adu_ids: string[];
  final_score: number;
  bridge_count: number;
  direction: 'SUPPORT' | 'ATTACK' | 'MIXED';
}

export function scoreAndGroup(
  rows: CandidateRow[],
  parentScore: number,
  sortBy: 'evidence' | 'weighted_bipolar' = 'evidence'
): { byAdu: Map<string, ScoredCandidate[]>; byReplyId: Map<string, ScoredCandidate> } {
  // Group rows by reply_id
  const replyMap = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    const existing = replyMap.get(row.reply_id);
    if (existing) {
      existing.push(row);
    } else {
      replyMap.set(row.reply_id, [row]);
    }
  }

  // Score each reply
  const scored = new Map<string, ScoredCandidate>();
  for (const [replyId, candidates] of replyMap) {
    const targetedAduIds = [...new Set(candidates.map(c => c.parent_adu_id))].sort();
    const bridgeCount = targetedAduIds.length;
    const bridgeMultiplier = 1.0 + 0.5 * (bridgeCount - 1);

    // Compute base_score from the best I-node
    let baseScore = 0;
    for (const c of candidates) {
      let nodeScore: number;
      if (sortBy === 'weighted_bipolar') {
        nodeScore = (c.wb_score > 0 ? c.wb_score : 0.5) * Math.log(1 + c.degree_centrality);
      } else {
        const er = c.evidence_rank > 0 ? c.evidence_rank : parentScore;
        nodeScore = er * Math.log(1 + c.degree_centrality);
      }
      if (nodeScore > baseScore) baseScore = nodeScore;
    }

    const finalScore = baseScore * bridgeMultiplier;

    // Determine direction
    const directions = new Set(candidates.map(c => c.direction));
    let direction: 'SUPPORT' | 'ATTACK' | 'MIXED';
    if (directions.size === 1) {
      direction = directions.has('SUPPORT') ? 'SUPPORT' : 'ATTACK';
    } else {
      direction = 'MIXED';
    }

    scored.set(replyId, {
      reply_id: replyId,
      targeted_adu_ids: targetedAduIds,
      final_score: finalScore,
      bridge_count: bridgeCount,
      direction,
    });
  }

  // Group scored candidates by their primary ADU (first targeted_adu_id)
  const byAdu = new Map<string, ScoredCandidate[]>();
  for (const candidate of scored.values()) {
    const primaryAdu = candidate.targeted_adu_ids[0]!;
    const existing = byAdu.get(primaryAdu);
    if (existing) {
      existing.push(candidate);
    } else {
      byAdu.set(primaryAdu, [candidate]);
    }
  }

  // Sort each ADU group by final_score DESC
  for (const group of byAdu.values()) {
    group.sort((a, b) => b.final_score - a.final_score);
  }

  return { byAdu, byReplyId: scored };
}

export function interleave(byAdu: Map<string, ScoredCandidate[]>): string[] {
  const groups = [...byAdu.values()];
  const seenReplyIds = new Set<string>();
  const result: string[] = [];

  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (const group of groups) {
      while (group.length > 0) {
        const candidate = group.shift()!;
        if (!seenReplyIds.has(candidate.reply_id)) {
          seenReplyIds.add(candidate.reply_id);
          result.push(candidate.reply_id);
          hasMore = true;
          break;
        }
      }
    }
  }

  return result;
}

function rowToSynthetic(
  row: ReplyWithAuthor,
  scored: ScoredCandidate,
  children: SyntheticReplyWithAuthor[],
  currentDepth: number
): SyntheticReplyWithAuthor {
  const hasReplies = row.reply_count > 0;
  const continueThreadUrl = currentDepth >= 3 && hasReplies ? `/reply/${row.id}` : undefined;

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
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    author: row.author,
    targeted_adu_ids: scored.targeted_adu_ids,
    final_score: scored.final_score,
    bridge_count: scored.bridge_count,
    direction: scored.direction,
    hasReplies,
    continueThreadUrl,
    children,
  };
}

/**
 * "Top" baseline: ranks all direct replies by vote score DESC, recursively.
 * Does not use the hypergraph — serves as a simple popularity baseline.
 */
export async function buildTopThread(
  postId: string,
  limit: number,
  cursor?: string,
  currentDepth: number = 1
): Promise<SyntheticThreadResponse> {
  const { items: replies, cursor: nextCursor, hasMore } = await ReplyRepo.findByPostId(postId, limit, cursor, 'top');

  if (replies.length === 0) {
    return { items: [], cursor: null, hasMore: false, fallback: currentDepth === 1 };
  }

  const childResultMap = new Map<string, SyntheticReplyWithAuthor[]>();
  if (currentDepth < 3) {
    const repliesNeedingChildren = replies.filter((r: ReplyWithAuthor) => r.reply_count > 0);
    if (repliesNeedingChildren.length > 0) {
      const childResults = await Promise.all(
        repliesNeedingChildren.map(async (reply: ReplyWithAuthor) => {
          const childResult = await buildTopThread(reply.id, 5, undefined, currentDepth + 1);
          return [reply.id, childResult.items] as const;
        })
      );
      for (const [id, children] of childResults) {
        childResultMap.set(id, children);
      }
    }
  }

  const items: SyntheticReplyWithAuthor[] = replies.map((row: ReplyWithAuthor) => {
    const fakeScored: ScoredCandidate = {
      reply_id: row.id,
      targeted_adu_ids: [],
      final_score: row.score,
      bridge_count: 0,
      direction: 'SUPPORT',
    };
    return rowToSynthetic(row, fakeScored, childResultMap.get(row.id) ?? [], currentDepth);
  });

  return { items, cursor: nextCursor, hasMore, fallback: false };
}

export async function buildSyntheticThread(
  parentType: 'post' | 'reply',
  parentId: string,
  limit: number,
  cursor?: string,
  sortBy: 'evidence' | 'weighted_bipolar' = 'evidence',
  currentDepth: number = 1,
  parentScore: number = 0
): Promise<SyntheticThreadResponse> {
  const v3Repo = createV3HypergraphRepo(getPool());

  // Fetch candidate rows
  const rows = await v3Repo.getCandidatesForSyntheticThread(parentType, parentId);

  if (rows.length === 0) {
    return { items: [], cursor: null, hasMore: false, fallback: currentDepth === 1 };
  }

  // Score and group
  const { byAdu, byReplyId: scoredMap } = scoreAndGroup(rows, parentScore, sortBy);

  // Interleave
  const orderedReplyIds = interleave(byAdu);

  if (orderedReplyIds.length === 0) {
    return { items: [], cursor: null, hasMore: false, fallback: currentDepth === 1 };
  }

  // Paginate using offset cursor
  const rawOffset = cursor ? parseInt(cursor, 10) : 0;
  const offset = Number.isFinite(rawOffset) && Number.isInteger(rawOffset) && rawOffset >= 0
    ? Math.min(rawOffset, orderedReplyIds.length)
    : 0;
  const pageIds = orderedReplyIds.slice(offset, offset + limit);
  const hasMore = offset + limit < orderedReplyIds.length;
  const nextCursor = hasMore ? String(offset + limit) : null;

  // Hydrate all page replies in one query (moved to repo)
  const replyRowMap = await ReplyRepo.findByIds(pageIds);

  // Batch-fetch children for all qualifying replies in parallel
  const childResultMap = new Map<string, SyntheticReplyWithAuthor[]>();
  if (currentDepth < 3) {
    const repliesNeedingChildren = pageIds.filter(id => (replyRowMap.get(id)?.reply_count ?? 0) > 0);
    if (repliesNeedingChildren.length > 0) {
      const childResults = await Promise.all(
        repliesNeedingChildren.map(async replyId => {
          const row = replyRowMap.get(replyId)!;
          const childResult = await buildSyntheticThread(
            'reply',
            replyId,
            5,
            undefined,
            sortBy,
            currentDepth + 1,
            row.score
          );
          return [replyId, childResult.items] as const;
        })
      );
      for (const [id, children] of childResults) {
        childResultMap.set(id, children);
      }
    }
  }

  // Build results in original ranked order
  const items: SyntheticReplyWithAuthor[] = [];
  for (const replyId of pageIds) {
    const row = replyRowMap.get(replyId);
    const scored = scoredMap.get(replyId);
    if (!row || !scored) continue;

    const children = childResultMap.get(replyId) ?? [];
    items.push(rowToSynthetic(row, scored, children, currentDepth));
  }

  return {
    items,
    cursor: nextCursor,
    hasMore,
    fallback: false,
  };
}
