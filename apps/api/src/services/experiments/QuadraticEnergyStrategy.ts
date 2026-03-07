import type { GraphNode, GraphEdge, RankedResult, RankingStrategy } from './RankingStrategy.js';
import { applyHingeCentrality } from './EvidenceRankStrategy.js';

/**
 * Bipartite Argumentation Ranking Strategy (Potyka 2018 + Burt network brokerage).
 *
 * Three strictly separated phases:
 *
 * Phase 1 — Epistemic Prior (Log-Scaled Votes):
 *   w_i = 0.5 + 0.49 * ln(1 + votes_i) / ln(1 + max_votes_in_graph)
 *   Guarantees w_i ∈ [0.5, 0.99], satisfying logit domain requirements.
 *   Log-scaling decompresses the bimodal Reddit vote distribution.
 *
 * Phase 2 — Logical Convergence (Quadratic Energy):
 *   B_i = logit(w_i)
 *   E_i = B_i + Σ_supporters(v_s) - Σ_attackers(v_a)
 *   v_i += α * (sigmoid(E_i) - v_i)   [α = 0.2, halt when max Δv < ε]
 *   Converges on cyclic graphs — no oscillation.
 *   Output: Dialectical Acceptability score v_i.
 *
 * Phase 3 — Bipartite Utility Scoring (Hinge Centrality):
 *   Final_Rank_i = v_i × (1 + ln(1 + HC_i))
 *   Applied post-convergence; does not alter the inner loop.
 *   HC_i is Brandes' betweenness centrality over the argument graph.
 */
export class QuadraticEnergyStrategy implements RankingStrategy {
  name = 'Alg_C (QuadraticEnergy)';

  private readonly maxIterations: number;
  private readonly alpha: number;
  private readonly epsilon: number;
  private readonly phase1Coeff: number;

  constructor(maxIterations = 50, alpha = 0.1, epsilon = 0.001, phase1Coeff = 0.3) {
    this.maxIterations = maxIterations;
    this.alpha = alpha;
    this.epsilon = epsilon;
    this.phase1Coeff = phase1Coeff;
  }

  rank(nodes: GraphNode[], edges: GraphEdge[], focalNodeId: string): RankedResult[] {
    if (nodes.length === 0) return [];

    // ── Phase 1: Epistemic Prior Initialization ───────────────────────────
    // w_i = 0.5 + 0.49 * ln(1 + votes_i) / ln(1 + max_votes)
    const maxVotes = nodes.reduce((m, n) => Math.max(m, Math.max(0, n.vote_score)), 0);
    const logMax = Math.log(1 + maxVotes);

    const w = new Map<string, number>();
    for (const n of nodes) {
      const logVotes = Math.log(1 + Math.max(0, n.vote_score));
      w.set(n.id, logMax > 0 ? 0.5 + this.phase1Coeff * (logVotes / logMax) : 0.5);
    }

    // ── Phase 2: Logical Convergence ──────────────────────────────────────
    const B = new Map<string, number>();
    for (const [id, wi] of w) {
      B.set(id, Math.log(wi / (1 - wi)));
    }

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

    const v = new Map<string, number>(w);

    for (let t = 0; t < this.maxIterations; t++) {
      const next = new Map<string, number>();
      let maxDelta = 0;

      for (const n of nodes) {
        const bi = B.get(n.id)!;
        const supportSum = (supporters.get(n.id) ?? []).reduce((acc, sid) => acc + (v.get(sid) ?? 0), 0);
        const attackSum  = (attackers.get(n.id)  ?? []).reduce((acc, aid) => acc + (v.get(aid) ?? 0), 0);

        const E_i     = bi + supportSum - attackSum;
        const target  = 1 / (1 + Math.exp(-E_i));
        const vi_next = (v.get(n.id) ?? 0) + this.alpha * (target - (v.get(n.id) ?? 0));

        next.set(n.id, vi_next);
        maxDelta = Math.max(maxDelta, Math.abs(vi_next - (v.get(n.id) ?? 0)));
      }

      for (const [id, val] of next) v.set(id, val);
      if (maxDelta < this.epsilon) break;
    }

    // ── Phase 3: Bipartite Utility Scoring ───────────────────────────────
    // Final_Rank_i = v_i × (1 + ln(1 + HC_i))
    const preHC: RankedResult[] = nodes.map((n, i) => ({
      id: n.id,
      text: n.text,
      rank: i + 1,
      score: v.get(n.id)!,
    }));

    const allNodeIds = focalNodeId
      ? [focalNodeId, ...nodes.map(n => n.id)]
      : nodes.map(n => n.id);

    return applyHingeCentrality(preHC, allNodeIds, edges);
  }
}
