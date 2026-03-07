import type { GraphNode, GraphEdge, RankedResult, RankingStrategy } from './RankingStrategy.js';

/**
 * Extending Modular Semantics for Bipolar Weighted Argumentation (Potyka 2019).
 *
 * Converges provably on cyclic graphs via damped Euler updates.
 *
 * Algorithm:
 *   w_i = clamp(basic_strength, 0.0, 1.0)
 *   v_i initialised to w_i
 *   Each step:
 *     agg_i   = Σ_supporters(v_s) - Σ_attackers(v_a)
 *     inf_i   = 1 - (1 - w_i^2) / (1 + w_i * exp(agg_i))
 *     v_i_next = (1 - alpha) * v_i + alpha * inf_i
 *   Halt when max |v_i_next - v_i| < epsilon
 *
 * Inertia: agg_i = 0 → inf_i = 1 - (1 - w_i^2)/(1 + w_i)
 *                            = 1 - (1 - w_i)(1 + w_i)/(1 + w_i)
 *                            = 1 - (1 - w_i)
 *                            = w_i   (exactly)
 */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class DampedModularStrategy implements RankingStrategy {
  name = 'Alg_D (DampedModular)';

  private readonly maxIterations: number;
  private readonly alpha: number;
  private readonly epsilon: number;

  constructor(maxIterations = 50, alpha = 0.5, epsilon = 0.001) {
    this.maxIterations = maxIterations;
    this.alpha = alpha;
    this.epsilon = epsilon;
  }

  rank(nodes: GraphNode[], edges: GraphEdge[], _focalNodeId: string): RankedResult[] {
    if (nodes.length === 0) return [];

    const w = new Map<string, number>();
    for (const n of nodes) {
      w.set(n.id, clamp(n.basic_strength, 0.0, 1.0));
    }

    // Build supporter/attacker maps
    const supporters = new Map<string, string[]>();
    const attackers  = new Map<string, string[]>();
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

    // Initialise
    const v = new Map<string, number>(w);

    for (let t = 0; t < this.maxIterations; t++) {
      const next = new Map<string, number>();
      let maxDelta = 0;

      for (const n of nodes) {
        const wi = w.get(n.id)!;
        const vi = v.get(n.id)!;

        const agg_i = (supporters.get(n.id) ?? []).reduce((acc, sid) => acc + (v.get(sid) ?? 0), 0)
                    - (attackers.get(n.id)  ?? []).reduce((acc, aid) => acc + (v.get(aid) ?? 0), 0);

        const inf_i    = 1 - (1 - wi * wi) / (1 + wi * Math.exp(agg_i));
        const vi_next  = (1 - this.alpha) * vi + this.alpha * inf_i;

        next.set(n.id, vi_next);
        maxDelta = Math.max(maxDelta, Math.abs(vi_next - vi));
      }

      for (const [id, val] of next) v.set(id, val);
      if (maxDelta < this.epsilon) break;
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
