import type { GraphNode, GraphEdge, RankedResult, RankingStrategy } from './RankingStrategy.js';

/**
 * Continuous Dynamical Systems for Weighted Bipolar Argumentation (Potyka 2018).
 *
 * Converges provably on cyclic graphs via Euler-based continuous approximation.
 *
 * Algorithm:
 *   w_i = clamp(basic_strength, 0.01, 0.99)
 *   B_i = ln(w_i / (1 - w_i))   [logit / inverse sigmoid]
 *   v_i initialised to w_i
 *   Each step:
 *     E_i      = B_i + Σ_supporters(v_s) - Σ_attackers(v_a)
 *     target_i = 1 / (1 + exp(-E_i))   [sigmoid]
 *     v_i_next = v_i + alpha * (target_i - v_i)
 *   Halt when max |v_i_next - v_i| < epsilon
 *
 * Inertia: no edges → E_i = B_i → target = sigmoid(logit(w_i)) = w_i → v_i = w_i
 */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class QuadraticEnergyStrategy implements RankingStrategy {
  name = 'Alg_C (QuadraticEnergy)';

  private readonly maxIterations: number;
  private readonly alpha: number;
  private readonly epsilon: number;

  constructor(maxIterations = 50, alpha = 0.2, epsilon = 0.001) {
    this.maxIterations = maxIterations;
    this.alpha = alpha;
    this.epsilon = epsilon;
  }

  rank(nodes: GraphNode[], edges: GraphEdge[], _focalNodeId: string): RankedResult[] {
    if (nodes.length === 0) return [];

    // Clamp basic_strength to open interval for logit
    const w = new Map<string, number>();
    for (const n of nodes) {
      w.set(n.id, clamp(n.basic_strength, 0.01, 0.99));
    }

    // Base energy B_i = logit(w_i)
    const B = new Map<string, number>();
    for (const [id, wi] of w) {
      B.set(id, Math.log(wi / (1 - wi)));
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
        const bi = B.get(n.id)!;
        const supportSum = (supporters.get(n.id) ?? []).reduce((acc, sid) => acc + (v.get(sid) ?? 0), 0);
        const attackSum  = (attackers.get(n.id)  ?? []).reduce((acc, aid) => acc + (v.get(aid) ?? 0), 0);

        const E_i      = bi + supportSum - attackSum;
        const target_i = 1 / (1 + Math.exp(-E_i));
        const vi_next  = (v.get(n.id) ?? 0) + this.alpha * (target_i - (v.get(n.id) ?? 0));

        next.set(n.id, vi_next);
        maxDelta = Math.max(maxDelta, Math.abs(vi_next - (v.get(n.id) ?? 0)));
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
