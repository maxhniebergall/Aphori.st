import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scoreAndGroup, interleave, buildSyntheticThread } from '../syntheticThreadService.js';
import type { ReplyWithAuthor } from '@chitin/shared';

// ── Minimal mocks for the two DB seams ──────────────────────────────────────

const mockGetCandidates = vi.hoisted(() => vi.fn());
const mockFindByIds = vi.hoisted(() => vi.fn());

vi.mock('../../db/repositories/V3HypergraphRepo.js', () => ({
  createV3HypergraphRepo: () => ({ getCandidatesForSyntheticThread: mockGetCandidates }),
}));

vi.mock('../../db/repositories/ReplyRepo.js', () => ({
  ReplyRepo: { findByIds: mockFindByIds },
}));

// getPool only needs to return something; the repo mock ignores the pool arg
vi.mock('../../db/pool.js', () => ({ getPool: () => ({}) }));

// ── Test fixtures ────────────────────────────────────────────────────────────

function makeCandidate(overrides: {
  reply_id: string;
  i_node_id?: string;
  parent_adu_id: string;
  direction?: string;
  evidence_rank?: number;
  degree_centrality?: number;
}) {
  return {
    reply_id: overrides.reply_id,
    i_node_id: overrides.i_node_id ?? `inode-${overrides.reply_id}`,
    parent_adu_id: overrides.parent_adu_id,
    direction: overrides.direction ?? 'SUPPORT',
    evidence_rank: overrides.evidence_rank ?? 1,
    degree_centrality: overrides.degree_centrality ?? 1,
  };
}

function makeReplyRow(id: string, overrides: Partial<ReplyWithAuthor> = {}): ReplyWithAuthor {
  const now = new Date().toISOString();
  return {
    id,
    post_id: 'post1',
    author_id: 'user1',
    parent_reply_id: null,
    target_adu_id: null,
    content: `Content of ${id}`,
    analysis_content_hash: 'hash',
    depth: 1,
    path: id,
    score: 0,
    reply_count: 0,
    quoted_text: null,
    quoted_source_type: null,
    quoted_source_id: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    author: { id: 'user1', display_name: 'Alice', user_type: 'human' },
    ...overrides,
  };
}

describe('scoreAndGroup', () => {
  it('returns empty maps for empty input', () => {
    const { byAdu, byReplyId } = scoreAndGroup([], 0);
    expect(byAdu.size).toBe(0);
    expect(byReplyId.size).toBe(0);
  });

  it('assigns SUPPORT direction when all candidates support', () => {
    const rows = [makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1', direction: 'SUPPORT' })];
    const { byReplyId } = scoreAndGroup(rows, 0);
    expect(byReplyId.get('r1')!.direction).toBe('SUPPORT');
  });

  it('assigns ATTACK direction when all candidates attack', () => {
    const rows = [makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1', direction: 'ATTACK' })];
    const { byReplyId } = scoreAndGroup(rows, 0);
    expect(byReplyId.get('r1')!.direction).toBe('ATTACK');
  });

  it('assigns MIXED direction when candidates have mixed directions', () => {
    const rows = [
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1', direction: 'SUPPORT' }),
      makeCandidate({ reply_id: 'r1', i_node_id: 'inode-r1-b', parent_adu_id: 'adu2', direction: 'ATTACK' }),
    ];
    const { byReplyId } = scoreAndGroup(rows, 0);
    expect(byReplyId.get('r1')!.direction).toBe('MIXED');
  });

  it('applies bridge multiplier for replies targeting multiple ADUs', () => {
    // r1 targets 2 ADUs → bridgeCount=2, multiplier=1.5
    const rows = [
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1', evidence_rank: 1, degree_centrality: 1 }),
      makeCandidate({ reply_id: 'r1', i_node_id: 'inode-r1-b', parent_adu_id: 'adu2', evidence_rank: 1, degree_centrality: 1 }),
    ];
    // r2 targets 1 ADU → bridgeCount=1, multiplier=1.0
    const rowsSingle = [
      makeCandidate({ reply_id: 'r2', parent_adu_id: 'adu1', evidence_rank: 1, degree_centrality: 1 }),
    ];
    const { byReplyId } = scoreAndGroup([...rows, ...rowsSingle], 0);
    expect(byReplyId.get('r1')!.final_score).toBeGreaterThan(byReplyId.get('r2')!.final_score);
    expect(byReplyId.get('r1')!.bridge_count).toBe(2);
  });

  it('sorts each ADU group by final_score DESC', () => {
    const rows = [
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1', evidence_rank: 1, degree_centrality: 1 }),
      makeCandidate({ reply_id: 'r2', parent_adu_id: 'adu1', evidence_rank: 5, degree_centrality: 5 }),
    ];
    const { byAdu } = scoreAndGroup(rows, 0);
    const group = byAdu.get('adu1')!;
    expect(group[0]!.reply_id).toBe('r2'); // higher score first
    expect(group[1]!.reply_id).toBe('r1');
  });

  it('uses parentScore as evidence_rank fallback when evidence_rank is 0', () => {
    const withZeroRank = [makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1', evidence_rank: 0, degree_centrality: 2 })];
    const withExplicitRank = [makeCandidate({ reply_id: 'r2', parent_adu_id: 'adu1', evidence_rank: 3, degree_centrality: 2 })];

    const { byReplyId: mapWithParent } = scoreAndGroup(withZeroRank, 3);
    const { byReplyId: mapExplicit } = scoreAndGroup(withExplicitRank, 0);

    // Both should use er=3, same degree_centrality → same final_score
    expect(mapWithParent.get('r1')!.final_score).toBeCloseTo(mapExplicit.get('r2')!.final_score, 5);
  });
});

describe('interleave', () => {
  it('returns empty array for empty input', () => {
    expect(interleave(new Map())).toEqual([]);
  });

  it('returns all ids from a single ADU group in score order', () => {
    const group = [
      { reply_id: 'r1', targeted_adu_ids: ['adu1'], final_score: 10, bridge_count: 1, direction: 'SUPPORT' as const },
      { reply_id: 'r2', targeted_adu_ids: ['adu1'], final_score: 5, bridge_count: 1, direction: 'SUPPORT' as const },
    ];
    const byAdu = new Map([['adu1', group]]);
    expect(interleave(byAdu)).toEqual(['r1', 'r2']);
  });

  it('round-robins across ADU groups', () => {
    const group1 = [
      { reply_id: 'r1', targeted_adu_ids: ['adu1'], final_score: 10, bridge_count: 1, direction: 'SUPPORT' as const },
      { reply_id: 'r3', targeted_adu_ids: ['adu1'], final_score: 3, bridge_count: 1, direction: 'SUPPORT' as const },
    ];
    const group2 = [
      { reply_id: 'r2', targeted_adu_ids: ['adu2'], final_score: 8, bridge_count: 1, direction: 'ATTACK' as const },
      { reply_id: 'r4', targeted_adu_ids: ['adu2'], final_score: 2, bridge_count: 1, direction: 'ATTACK' as const },
    ];
    const byAdu = new Map([['adu1', group1], ['adu2', group2]]);
    const result = interleave(byAdu);
    // Should alternate: r1 (adu1), r2 (adu2), r3 (adu1), r4 (adu2)
    expect(result).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('deduplicates replies that appear in multiple ADU groups', () => {
    const sharedReply = { reply_id: 'r1', targeted_adu_ids: ['adu1', 'adu2'], final_score: 10, bridge_count: 2, direction: 'MIXED' as const };
    const group1 = [sharedReply];
    const group2 = [
      sharedReply,
      { reply_id: 'r2', targeted_adu_ids: ['adu2'], final_score: 5, bridge_count: 1, direction: 'SUPPORT' as const },
    ];
    const byAdu = new Map([['adu1', group1], ['adu2', group2]]);
    const result = interleave(byAdu);
    expect(result.filter(id => id === 'r1').length).toBe(1);
    expect(result).toContain('r2');
  });
});

describe('buildSyntheticThread', () => {
  beforeEach(() => {
    mockGetCandidates.mockReset();
    mockFindByIds.mockReset();
  });

  it('returns fallback=true at depth 1 when there are no candidates', async () => {
    mockGetCandidates.mockResolvedValue([]);
    const result = await buildSyntheticThread('post', 'post1', 10);
    expect(result).toEqual({ items: [], cursor: null, hasMore: false, fallback: true });
  });

  it('returns fallback=false at depth >1 when there are no candidates', async () => {
    mockGetCandidates.mockResolvedValue([]);
    const result = await buildSyntheticThread('reply', 'r1', 10, undefined, 2);
    expect(result.fallback).toBe(false);
    expect(result.items).toEqual([]);
  });

  it('returns items in interleaved ranked order', async () => {
    mockGetCandidates.mockResolvedValue([
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1', evidence_rank: 5, degree_centrality: 2 }),
      makeCandidate({ reply_id: 'r2', parent_adu_id: 'adu1', evidence_rank: 1, degree_centrality: 1 }),
    ]);
    mockFindByIds.mockResolvedValue(new Map([
      ['r1', makeReplyRow('r1')],
      ['r2', makeReplyRow('r2')],
    ]));

    const result = await buildSyntheticThread('post', 'post1', 10);

    expect(result.fallback).toBe(false);
    expect(result.items.map(i => i.id)).toEqual(['r1', 'r2']); // r1 scores higher
  });

  it('paginates correctly: first page has hasMore=true and correct cursor', async () => {
    // 3 candidates, limit=2 → page 1 should have hasMore=true
    mockGetCandidates.mockResolvedValue([
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1' }),
      makeCandidate({ reply_id: 'r2', parent_adu_id: 'adu1' }),
      makeCandidate({ reply_id: 'r3', parent_adu_id: 'adu1' }),
    ]);
    mockFindByIds.mockResolvedValue(new Map([
      ['r1', makeReplyRow('r1')],
      ['r2', makeReplyRow('r2')],
    ]));

    const page1 = await buildSyntheticThread('post', 'post1', 2);

    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.cursor).toBe('2');
  });

  it('paginates correctly: second page uses cursor offset and has hasMore=false', async () => {
    mockGetCandidates.mockResolvedValue([
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1' }),
      makeCandidate({ reply_id: 'r2', parent_adu_id: 'adu1' }),
      makeCandidate({ reply_id: 'r3', parent_adu_id: 'adu1' }),
    ]);
    mockFindByIds.mockResolvedValue(new Map([
      ['r3', makeReplyRow('r3')],
    ]));

    const page2 = await buildSyntheticThread('post', 'post1', 2, '2');

    expect(page2.items.map(i => i.id)).toEqual(['r3']);
    expect(page2.hasMore).toBe(false);
    expect(page2.cursor).toBeNull();
  });

  it('does not fetch children at depth 3', async () => {
    mockGetCandidates.mockResolvedValue([
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1' }),
    ]);
    // reply_count > 0 would normally trigger child fetch
    mockFindByIds.mockResolvedValue(new Map([
      ['r1', makeReplyRow('r1', { reply_count: 5 })],
    ]));

    const result = await buildSyntheticThread('reply', 'parent', 10, undefined, 3);

    // getCandidates called once for parent, never again for children
    expect(mockGetCandidates).toHaveBeenCalledTimes(1);
    expect(result.items[0]!.children).toEqual([]);
  });

  it('sets continueThreadUrl at depth 3 when reply has children', async () => {
    mockGetCandidates.mockResolvedValue([
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1' }),
    ]);
    mockFindByIds.mockResolvedValue(new Map([
      ['r1', makeReplyRow('r1', { reply_count: 3 })],
    ]));

    const result = await buildSyntheticThread('reply', 'parent', 10, undefined, 3);

    expect(result.items[0]!.continueThreadUrl).toBe('/reply/r1');
    expect(result.items[0]!.hasReplies).toBe(true);
  });

  it('does not set continueThreadUrl at depth <3', async () => {
    mockGetCandidates.mockResolvedValue([
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1' }),
    ]);
    // child fetch at depth 2 → child has no further candidates
    mockGetCandidates
      .mockResolvedValueOnce([makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1' })]) // depth 1
      .mockResolvedValueOnce([]); // depth 2 child lookup returns nothing
    mockFindByIds.mockResolvedValue(new Map([
      ['r1', makeReplyRow('r1', { reply_count: 2 })],
    ]));

    const result = await buildSyntheticThread('post', 'post1', 10, undefined, 1);

    expect(result.items[0]!.continueThreadUrl).toBeUndefined();
  });

  it('skips replies missing from hydration without crashing', async () => {
    mockGetCandidates.mockResolvedValue([
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1' }),
      makeCandidate({ reply_id: 'r2', parent_adu_id: 'adu1' }),
    ]);
    // r2 is absent from findByIds (e.g. deleted between calls)
    mockFindByIds.mockResolvedValue(new Map([
      ['r1', makeReplyRow('r1')],
    ]));

    const result = await buildSyntheticThread('post', 'post1', 10);

    expect(result.items.map(i => i.id)).toEqual(['r1']);
  });

  it('attaches scored metadata (direction, bridge_count, final_score) to each item', async () => {
    mockGetCandidates.mockResolvedValue([
      makeCandidate({ reply_id: 'r1', parent_adu_id: 'adu1', direction: 'ATTACK', evidence_rank: 2, degree_centrality: 3 }),
    ]);
    mockFindByIds.mockResolvedValue(new Map([
      ['r1', makeReplyRow('r1')],
    ]));

    const result = await buildSyntheticThread('post', 'post1', 10);
    const item = result.items[0]!;

    expect(item.direction).toBe('ATTACK');
    expect(item.bridge_count).toBe(1);
    expect(item.final_score).toBeGreaterThan(0);
    expect(item.targeted_adu_ids).toEqual(['adu1']);
  });
});
