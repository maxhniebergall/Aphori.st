import type { GraphNode, GraphEdge, RankedResult, RankingStrategy } from './RankingStrategy.js';

/**
 * Weighted Bipolar Argumentation (Amgoud & Ben-Naim 2015, Euler-based semantics).
 *
 * Basic strength:  β(a) = sigmoid(vote_score), clamped to [0,1]
 * h(x) = 1 - e^(-x)   [monotone increasing, maps [0,∞) → [0,1)]
 *
 * Iterative formula (20 iterations):
 *   v(a) = β(a) + (1 - β(a)) * h(Σ_{b supports a} v(b))
 *                - β(a)       * h(Σ_{b attacks a} v(b))
 *   v(a) = clamp(v(a), 0, 1)
 *
 * Satisfies:
 *   - Inertia:           no edges → v(a) = β(a)
 *   - Counter-balancing: equal support/attack → v(a) ≈ β(a)
 */

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function h(x: number): number {
  return 1 - Math.exp(-x);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class WeightedBipolarStrategy implements RankingStrategy {
  name = 'Alg_B (WeightedBipolar)';

  private readonly iterations: number;

  constructor(iterations = 20) {
    this.iterations = iterations;
  }

  rank(nodes: GraphNode[], edges: GraphEdge[], _focalNodeId: string): RankedResult[] {
    if (nodes.length === 0) return [];

    // Basic strengths
    const beta = new Map<string, number>();
    for (const n of nodes) {
      beta.set(n.id, clamp(n.basic_strength > 0 ? n.basic_strength : sigmoid(n.vote_score), 0, 1));
    }

    // Build neighbour maps
    const supporters = new Map<string, string[]>();
    const attackers = new Map<string, string[]>();
    for (const n of nodes) {
      supporters.set(n.id, []);
      attackers.set(n.id, []);
    }
    for (const e of edges) {
      if (e.direction === 'SUPPORT') {
        supporters.get(e.to_node_id)?.push(e.from_node_id);
      } else {
        attackers.get(e.to_node_id)?.push(e.from_node_id);
      }
    }

    // Iterative strength computation
    const v = new Map<string, number>();
    for (const [id, b] of beta) {
      v.set(id, b);
    }

    for (let iter = 0; iter < this.iterations; iter++) {
      const next = new Map<string, number>();

      for (const n of nodes) {
        const b = beta.get(n.id)!;

        const supportSum = (supporters.get(n.id) ?? []).reduce(
          (acc, sid) => acc + (v.get(sid) ?? 0),
          0
        );
        const attackSum = (attackers.get(n.id) ?? []).reduce(
          (acc, aid) => acc + (v.get(aid) ?? 0),
          0
        );

        const newV = b + (1 - b) * h(supportSum) - b * h(attackSum);
        next.set(n.id, clamp(newV, 0, 1));
      }

      for (const [id, val] of next) {
        v.set(id, val);
      }
    }

    const scored = nodes.map(n => ({ node: n, score: v.get(n.id)! }));
    scored.sort((a, b) => b.score - a.score);

    return scored.map((item, i) => ({
      id: item.node.id,
      text: item.node.text,
      rank: i + 1,
      score: item.score,
    }));
  }
}
