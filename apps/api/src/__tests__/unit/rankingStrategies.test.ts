import { describe, it, expect } from 'vitest';
import { EvidenceRankStrategy } from '../../services/experiments/EvidenceRankStrategy.js';
import { QuadraticEnergyStrategy } from '../../services/experiments/QuadraticEnergyStrategy.js';
import { DampedModularStrategy } from '../../services/experiments/DampedModularStrategy.js';
import type { GraphNode, GraphEdge } from '../../services/experiments/RankingStrategy.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeNode(id: string, voteScore = 0, karma = 0): GraphNode {
  return { id, text: `text-${id}`, basic_strength: 0.5, vote_score: voteScore, user_karma: karma };
}

// ── QuadraticEnergy tests ─────────────────────────────────────────────────

describe('QuadraticEnergyStrategy', () => {
  const alg = new QuadraticEnergyStrategy();

  it('Inertia: no edges → v(a) ≈ basic_strength', () => {
    const nodes: GraphNode[] = [
      { id: 'a', text: '', basic_strength: 0.8, vote_score: 0, user_karma: 0 },
      { id: 'b', text: '', basic_strength: 0.3, vote_score: 0, user_karma: 0 },
      { id: 'c', text: '', basic_strength: 0.5, vote_score: 0, user_karma: 0 },
    ];
    const results = alg.rank(nodes, [], 'focal');
    for (const r of results) {
      const node = nodes.find(n => n.id === r.id)!;
      expect(r.score).toBeCloseTo(node.basic_strength, 2);
    }
  });

  it('Converges on cyclic graph (A attacks B, B attacks A)', () => {
    const nodes: GraphNode[] = [
      { id: 'A', text: '', basic_strength: 0.7, vote_score: 0, user_karma: 0 },
      { id: 'B', text: '', basic_strength: 0.6, vote_score: 0, user_karma: 0 },
    ];
    const edges: GraphEdge[] = [
      { from_node_id: 'A', to_node_id: 'B', direction: 'ATTACK', confidence: 1 },
      { from_node_id: 'B', to_node_id: 'A', direction: 'ATTACK', confidence: 1 },
    ];
    // Should not throw; scores must be finite and in (0, 1)
    const results = alg.rank(nodes, edges, '');
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(isFinite(r.score)).toBe(true);
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThan(1);
    }
  });

  it('Support edge boosts target above unsupported peer', () => {
    const nodes: GraphNode[] = [
      { id: 'helper',      text: '', basic_strength: 0.9, vote_score: 0, user_karma: 0 },
      { id: 'supported',   text: '', basic_strength: 0.5, vote_score: 0, user_karma: 0 },
      { id: 'unsupported', text: '', basic_strength: 0.5, vote_score: 0, user_karma: 0 },
    ];
    const edges: GraphEdge[] = [
      { from_node_id: 'helper', to_node_id: 'supported', direction: 'SUPPORT', confidence: 1 },
    ];
    const results = alg.rank(nodes, edges, '');
    const supported   = results.find(r => r.id === 'supported')!;
    const unsupported = results.find(r => r.id === 'unsupported')!;
    expect(supported.score).toBeGreaterThan(unsupported.score);
    expect(supported.rank).toBeLessThan(unsupported.rank);
  });

  it('Attack edge reduces target below safe peer', () => {
    const nodes: GraphNode[] = [
      { id: 'attacker', text: '', basic_strength: 0.9, vote_score: 0, user_karma: 0 },
      { id: 'attacked', text: '', basic_strength: 0.6, vote_score: 0, user_karma: 0 },
      { id: 'safe',     text: '', basic_strength: 0.6, vote_score: 0, user_karma: 0 },
    ];
    const edges: GraphEdge[] = [
      { from_node_id: 'attacker', to_node_id: 'attacked', direction: 'ATTACK', confidence: 1 },
    ];
    const results = alg.rank(nodes, edges, '');
    const attacked = results.find(r => r.id === 'attacked')!;
    const safe     = results.find(r => r.id === 'safe')!;
    expect(attacked.score).toBeLessThan(safe.score);
  });

  it('Returns correct 1-indexed ranking', () => {
    const nodes: GraphNode[] = [
      { id: 'a', text: '', basic_strength: 0.9, vote_score: 0, user_karma: 0 },
      { id: 'b', text: '', basic_strength: 0.5, vote_score: 0, user_karma: 0 },
      { id: 'c', text: '', basic_strength: 0.2, vote_score: 0, user_karma: 0 },
    ];
    const results = alg.rank(nodes, [], '');
    const ranks = results.map(r => r.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3]);
  });

  it('Handles single node', () => {
    const nodes: GraphNode[] = [{ id: 'x', text: '', basic_strength: 0.7, vote_score: 0, user_karma: 0 }];
    const results = alg.rank(nodes, [], '');
    expect(results).toHaveLength(1);
    expect(results[0]!.rank).toBe(1);
  });

  it('Handles empty node list', () => {
    expect(alg.rank([], [], '')).toHaveLength(0);
  });
});

// ── DampedModular tests ───────────────────────────────────────────────────

describe('DampedModularStrategy', () => {
  const alg = new DampedModularStrategy();

  it('Inertia: no edges → v(a) = basic_strength exactly', () => {
    // When agg=0, inf_i = w_i algebraically, so no update occurs
    const nodes: GraphNode[] = [
      { id: 'a', text: '', basic_strength: 0.8, vote_score: 0, user_karma: 0 },
      { id: 'b', text: '', basic_strength: 0.3, vote_score: 0, user_karma: 0 },
      { id: 'c', text: '', basic_strength: 0.5, vote_score: 0, user_karma: 0 },
    ];
    const results = alg.rank(nodes, [], 'focal');
    for (const r of results) {
      const node = nodes.find(n => n.id === r.id)!;
      expect(r.score).toBeCloseTo(node.basic_strength, 6);
    }
  });

  it('Converges on cyclic graph (A attacks B, B attacks A)', () => {
    const nodes: GraphNode[] = [
      { id: 'A', text: '', basic_strength: 0.7, vote_score: 0, user_karma: 0 },
      { id: 'B', text: '', basic_strength: 0.6, vote_score: 0, user_karma: 0 },
    ];
    const edges: GraphEdge[] = [
      { from_node_id: 'A', to_node_id: 'B', direction: 'ATTACK', confidence: 1 },
      { from_node_id: 'B', to_node_id: 'A', direction: 'ATTACK', confidence: 1 },
    ];
    const results = alg.rank(nodes, edges, '');
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(isFinite(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('Support edge boosts target above unsupported peer', () => {
    const nodes: GraphNode[] = [
      { id: 'helper',      text: '', basic_strength: 0.9, vote_score: 0, user_karma: 0 },
      { id: 'supported',   text: '', basic_strength: 0.5, vote_score: 0, user_karma: 0 },
      { id: 'unsupported', text: '', basic_strength: 0.5, vote_score: 0, user_karma: 0 },
    ];
    const edges: GraphEdge[] = [
      { from_node_id: 'helper', to_node_id: 'supported', direction: 'SUPPORT', confidence: 1 },
    ];
    const results = alg.rank(nodes, edges, '');
    const supported   = results.find(r => r.id === 'supported')!;
    const unsupported = results.find(r => r.id === 'unsupported')!;
    expect(supported.score).toBeGreaterThan(unsupported.score);
    expect(supported.rank).toBeLessThan(unsupported.rank);
  });

  it('Attack edge reduces target below safe peer', () => {
    const nodes: GraphNode[] = [
      { id: 'attacker', text: '', basic_strength: 0.9, vote_score: 0, user_karma: 0 },
      { id: 'attacked', text: '', basic_strength: 0.6, vote_score: 0, user_karma: 0 },
      { id: 'safe',     text: '', basic_strength: 0.6, vote_score: 0, user_karma: 0 },
    ];
    const edges: GraphEdge[] = [
      { from_node_id: 'attacker', to_node_id: 'attacked', direction: 'ATTACK', confidence: 1 },
    ];
    const results = alg.rank(nodes, edges, '');
    const attacked = results.find(r => r.id === 'attacked')!;
    const safe     = results.find(r => r.id === 'safe')!;
    expect(attacked.score).toBeLessThan(safe.score);
  });

  it('Returns correct 1-indexed ranking', () => {
    const nodes: GraphNode[] = [
      { id: 'a', text: '', basic_strength: 0.9, vote_score: 0, user_karma: 0 },
      { id: 'b', text: '', basic_strength: 0.5, vote_score: 0, user_karma: 0 },
      { id: 'c', text: '', basic_strength: 0.2, vote_score: 0, user_karma: 0 },
    ];
    const results = alg.rank(nodes, [], '');
    const ranks = results.map(r => r.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3]);
  });
});

// ── EvidenceRank tests ────────────────────────────────────────────────────

describe('EvidenceRankStrategy', () => {
  const alg = new EvidenceRankStrategy();

  it('Returns a result for each node', () => {
    const nodes = [makeNode('a', 5, 100), makeNode('b', 2, 50), makeNode('c', 0, 10)];
    const results = alg.rank(nodes, [], 'focal');
    expect(results).toHaveLength(3);
  });

  it('Higher vote score node ranks first when no edges', () => {
    const nodes = [makeNode('low', 1), makeNode('high', 10), makeNode('mid', 5)];
    const results = alg.rank(nodes, [], 'focal');
    results.sort((a, b) => a.rank - b.rank);
    expect(results[0]!.id).toBe('high');
  });

  it('Support edge boosts the target node', () => {
    const nodes = [makeNode('strong', 10), makeNode('weak', 1), makeNode('peer', 1)];
    const edges: GraphEdge[] = [
      { from_node_id: 'strong', to_node_id: 'weak', direction: 'SUPPORT', confidence: 1 },
    ];
    const results = alg.rank(nodes, edges, 'focal');
    const weak = results.find(r => r.id === 'weak')!;
    const peer = results.find(r => r.id === 'peer')!;
    expect(weak.rank).toBeLessThan(peer.rank);
  });

  it('Rank ordering is 1-indexed and unique', () => {
    const nodes = [makeNode('a', 5), makeNode('b', 3), makeNode('c', 1)];
    const results = alg.rank(nodes, [], 'focal');
    const ranks = results.map(r => r.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3]);
  });
});
