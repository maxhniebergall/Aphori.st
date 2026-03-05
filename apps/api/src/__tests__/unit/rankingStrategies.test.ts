import { describe, it, expect } from 'vitest';
import { EvidenceRankStrategy } from '../../services/experiments/EvidenceRankStrategy.js';
import { WeightedBipolarStrategy } from '../../services/experiments/WeightedBipolarStrategy.js';
import type { GraphNode, GraphEdge } from '../../services/experiments/RankingStrategy.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeNode(id: string, voteScore = 0, karma = 0): GraphNode {
  return { id, text: `text-${id}`, basic_strength: 0.5, vote_score: voteScore, user_karma: karma };
}

// ── WeightedBipolar tests ─────────────────────────────────────────────────

describe('WeightedBipolarStrategy', () => {
  const alg = new WeightedBipolarStrategy();

  it('Inertia: no edges → v(a) = β(a)', () => {
    const nodes: GraphNode[] = [
      makeNode('a', 2),
      makeNode('b', -1),
      makeNode('c', 0),
    ];
    const edges: GraphEdge[] = [];
    const results = alg.rank(nodes, edges, 'focal');

    // β(a) = sigmoid(vote_score)
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

    for (const r of results) {
      const node = nodes.find(n => n.id === r.id)!;
      const expected = sigmoid(node.vote_score);
      expect(r.score).toBeCloseTo(expected, 6);
    }
  });

  it('Counter-balancing: equal support and attack with β=0.5 → v(a) = β(a)', () => {
    // The Amgoud-Ben-Naim formula simplifies to v(a) = β(a) + h(S)*(1 - 2β(a))
    // which cancels exactly when β(a) = 0.5 (i.e. vote_score = 0 → sigmoid(0) = 0.5)
    const nodes: GraphNode[] = [
      makeNode('supporter', 3),
      makeNode('attacker', 3),
      makeNode('target', 0), // vote_score=0 → β=0.5
    ];
    const edges: GraphEdge[] = [
      { from_node_id: 'supporter', to_node_id: 'target', direction: 'SUPPORT', confidence: 1 },
      { from_node_id: 'attacker',  to_node_id: 'target', direction: 'ATTACK',  confidence: 1 },
    ];
    const results = alg.rank(nodes, edges, 'focal');
    const targetResult = results.find(r => r.id === 'target')!;

    // β(target) = sigmoid(0) = 0.5; with equal support/attack sum, v(target) = 0.5
    expect(targetResult.score).toBeCloseTo(0.5, 6);
  });

  it('Supported node ranks higher than unsupported peer', () => {
    const nodes: GraphNode[] = [
      makeNode('helper', 5),
      makeNode('supported', 0),
      makeNode('unsupported', 0),
    ];
    const edges: GraphEdge[] = [
      { from_node_id: 'helper', to_node_id: 'supported', direction: 'SUPPORT', confidence: 1 },
    ];
    const results = alg.rank(nodes, edges, 'focal');
    const supported   = results.find(r => r.id === 'supported')!;
    const unsupported = results.find(r => r.id === 'unsupported')!;

    expect(supported.score).toBeGreaterThan(unsupported.score);
    expect(supported.rank).toBeLessThan(unsupported.rank);
  });

  it('Attacked node ranks lower than peer with no attack', () => {
    const nodes: GraphNode[] = [
      makeNode('attacker', 5),
      makeNode('attacked', 2),
      makeNode('safe', 2),
    ];
    const edges: GraphEdge[] = [
      { from_node_id: 'attacker', to_node_id: 'attacked', direction: 'ATTACK', confidence: 1 },
    ];
    const results = alg.rank(nodes, edges, 'focal');
    const attacked = results.find(r => r.id === 'attacked')!;
    const safe     = results.find(r => r.id === 'safe')!;

    expect(attacked.score).toBeLessThan(safe.score);
  });

  it('Returns correct rank ordering (1-indexed, ascending)', () => {
    const nodes: GraphNode[] = [makeNode('a', 10), makeNode('b', 0), makeNode('c', -5)];
    const results = alg.rank(nodes, [], 'f');

    const ranks = results.map(r => r.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3]);
  });

  it('Handles single node', () => {
    const results = alg.rank([makeNode('x', 1)], [], 'f');
    expect(results).toHaveLength(1);
    expect(results[0]!.rank).toBe(1);
  });

  it('Handles empty node list', () => {
    const results = alg.rank([], [], 'f');
    expect(results).toHaveLength(0);
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
