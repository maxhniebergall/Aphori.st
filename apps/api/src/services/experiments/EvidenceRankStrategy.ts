import type { GraphNode, GraphEdge, RankedResult, RankingStrategy } from './RankingStrategy.js';
import type { SubgraphNode, SchemeEdge } from '../investigateService.js';

// Re-export the pure functions from investigateService by duplicating them here
// to avoid modifying investigateService.ts.

function calculateEvidenceRank(
  nodes: SubgraphNode[],
  schemeEdges: SchemeEdge[],
  focalNodeId: string,
  damping: number = 0.85,
  iterations: number = 20
): Map<string, number> {
  const ranks = new Map<string, number>();

  for (const node of nodes) {
    const baseSocial = node.vote_score * (1 + Math.log(1 + Math.max(0, node.user_karma)) / 10);
    ranks.set(node.id, Math.max(0, baseSocial));
  }

  if (!ranks.has(focalNodeId)) {
    ranks.set(focalNodeId, 1);
  }

  const supporters = new Map<string, Array<{ from: string; conf: number }>>();
  const attackers = new Map<string, Array<{ from: string; conf: number }>>();
  for (const node of nodes) {
    supporters.set(node.id, []);
    attackers.set(node.id, []);
  }
  for (const edge of schemeEdges) {
    if (edge.direction === 'SUPPORT') {
      supporters.get(edge.to_node_id)?.push({ from: edge.from_node_id, conf: edge.scheme_confidence });
    } else {
      attackers.get(edge.to_node_id)?.push({ from: edge.from_node_id, conf: edge.scheme_confidence });
    }
  }

  for (let iter = 0; iter < iterations; iter++) {
    const newRanks = new Map<string, number>();

    for (const node of nodes) {
      const baseSocial = node.vote_score * (1 + Math.log(1 + Math.max(0, node.user_karma)) / 10);

      let supportSum = 0;
      for (const { from, conf } of (supporters.get(node.id) ?? [])) {
        supportSum += (ranks.get(from) ?? 0) * conf;
      }

      let attackSum = 0;
      for (const { from, conf } of (attackers.get(node.id) ?? [])) {
        attackSum += (ranks.get(from) ?? 0) * conf;
      }

      const newRank = baseSocial + damping * (supportSum - attackSum);
      newRanks.set(node.id, Math.max(0, newRank));
    }

    for (const [id, rank] of newRanks) {
      ranks.set(id, rank);
    }
  }

  return ranks;
}

function calculateHingeCentrality(
  nodeIds: string[],
  schemeEdges: SchemeEdge[]
): Map<string, number> {
  const betweenness = new Map<string, number>();
  for (const id of nodeIds) {
    betweenness.set(id, 0);
  }

  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    adj.set(id, []);
  }
  for (const edge of schemeEdges) {
    if (nodeIds.includes(edge.from_node_id) && nodeIds.includes(edge.to_node_id)) {
      adj.get(edge.from_node_id)?.push(edge.to_node_id);
    }
  }

  for (const source of nodeIds) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();

    for (const id of nodeIds) {
      pred.set(id, []);
      sigma.set(id, 0);
      dist.set(id, -1);
    }

    sigma.set(source, 1);
    dist.set(source, 0);

    const queue: string[] = [source];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);

      for (const w of (adj.get(v) ?? [])) {
        if (dist.get(w) === -1) {
          queue.push(w);
          dist.set(w, (dist.get(v) ?? 0) + 1);
        }
        if (dist.get(w) === (dist.get(v) ?? 0) + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 0));
          pred.get(w)?.push(v);
        }
      }
    }

    const delta = new Map<string, number>();
    for (const id of nodeIds) {
      delta.set(id, 0);
    }

    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of (pred.get(w) ?? [])) {
        const sigmaV = sigma.get(v) ?? 0;
        const sigmaW = sigma.get(w) ?? 1;
        const d = (sigmaV / sigmaW) * (1 + (delta.get(w) ?? 0));
        delta.set(v, (delta.get(v) ?? 0) + d);
      }
      if (w !== source) {
        betweenness.set(w, (betweenness.get(w) ?? 0) + (delta.get(w) ?? 0));
      }
    }
  }

  return betweenness;
}

/** Adapts common GraphNode/GraphEdge to the internal SubgraphNode/SchemeEdge formats. */
function toSubgraphNodes(nodes: GraphNode[]): SubgraphNode[] {
  return nodes.map(n => ({
    id: n.id,
    content: n.text,
    rewritten_text: null,
    epistemic_type: 'claim',
    fvp_confidence: n.basic_strength,
    source_type: 'reply' as const,
    source_id: n.id,
    source_post_id: '',
    direction: 'SUPPORT' as const,
    scheme_id: n.id,
    scheme_confidence: 1,
    vote_score: n.vote_score,
    user_karma: n.user_karma,
    source_title: null,
    source_author: null,
    source_author_id: null,
    embedding: n.embedding ?? null,
    extracted_values: [],
  }));
}

function toSchemeEdges(edges: GraphEdge[]): SchemeEdge[] {
  return edges.map(e => ({
    scheme_id: `${e.from_node_id}→${e.to_node_id}`,
    from_node_id: e.from_node_id,
    to_node_id: e.to_node_id,
    direction: e.direction,
    scheme_confidence: e.confidence,
  }));
}

/**
 * Applies hinge centrality (betweenness) boost to any pre-ranked result set.
 * score' = score * (1 + log(1 + hc))
 * Results are re-sorted and re-ranked after boosting.
 */
export function applyHingeCentrality(
  results: RankedResult[],
  nodeIds: string[],
  edges: GraphEdge[]
): RankedResult[] {
  const hcScores = calculateHingeCentrality(nodeIds, toSchemeEdges(edges));
  const rescored = results.map(r => ({
    ...r,
    score: r.score * (1 + Math.log(1 + (hcScores.get(r.id) ?? 0))),
  }));
  rescored.sort((a, b) => b.score - a.score);
  return rescored.map((item, i) => ({ ...item, rank: i + 1 }));
}

export class EvidenceRankStrategy implements RankingStrategy {
  name = 'Alg_A (EvidenceRank)';

  rank(nodes: GraphNode[], edges: GraphEdge[], focalNodeId: string): RankedResult[] {
    const subNodes = toSubgraphNodes(nodes);
    const schemeEdges = toSchemeEdges(edges);
    const allNodeIds = [focalNodeId, ...nodes.map(n => n.id)];

    const erScores = calculateEvidenceRank(subNodes, schemeEdges, focalNodeId);
    const hcScores = calculateHingeCentrality(allNodeIds, schemeEdges);

    const scored = nodes.map(n => {
      const er = erScores.get(n.id) ?? 0;
      const hc = hcScores.get(n.id) ?? 0;
      const finalScore = er * (1 + Math.log(1 + hc));
      return { node: n, score: finalScore };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.map((item, i) => ({
      id: item.node.id,
      text: item.node.text,
      rank: i + 1,
      score: item.score,
    }));
  }
}
