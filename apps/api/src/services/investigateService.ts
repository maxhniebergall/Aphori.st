/**
 * Investigate Service: Implements the Synthetic Global Thread ranking pipeline.
 *
 * Pipeline:
 *   1. EvidenceRank  – Social-topological flow (PageRank variant with BAF semantics)
 *   2. HingeCentrality – Brandes' betweenness centrality on the scheme graph
 *   3. FinalScore = ER * (1 + log(1 + HC))
 *   4. K-Means clustering on embeddings for viewpoint diversity
 *   5. Ghost Node (enthymeme) surfacing
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface SubgraphNode {
  id: string;
  content: string;
  rewritten_text: string | null;
  epistemic_type: string;
  fvp_confidence: number;
  source_type: 'post' | 'reply';
  source_id: string;
  source_post_id: string;
  direction: 'SUPPORT' | 'ATTACK';
  scheme_id: string;
  scheme_confidence: number;
  vote_score: number;
  user_karma: number;
  source_title: string | null;
  source_author: string | null;
  source_author_id: string | null;
  embedding: number[] | null;
  extracted_values: string[];
}

export interface SchemeEdge {
  scheme_id: string;
  from_node_id: string; // premise
  to_node_id: string;   // conclusion
  direction: 'SUPPORT' | 'ATTACK';
  scheme_confidence: number;
}

export interface RankedNode extends SubgraphNode {
  evidence_rank: number;
  hinge_centrality: number;
  final_score: number;
  cluster_id: number;
}

// ── Algorithm 1: EvidenceRank ──────────────────────────────────────────────

/**
 * EvidenceRank: BAF-inspired iterative ranking.
 * ER(v) = S(v) + d * (Σ ER(s)*conf(s→v) - Σ ER(a)*conf(a→v))
 * where S(v) = vote_score * (1 + log(1 + user_karma) / 10)
 * Truncated to min 0 (fully defeated nodes).
 */
export function calculateEvidenceRank(
  nodes: SubgraphNode[],
  schemeEdges: SchemeEdge[],
  focalNodeId: string,
  damping: number = 0.85,
  iterations: number = 20
): Map<string, number> {
  const ranks = new Map<string, number>();

  // Initialize with base social scores
  for (const node of nodes) {
    const baseSocial = node.vote_score * (1 + Math.log(1 + Math.max(0, node.user_karma)) / 10);
    ranks.set(node.id, Math.max(0, baseSocial));
  }

  // Give the focal node a seed rank for propagation
  if (!ranks.has(focalNodeId)) {
    ranks.set(focalNodeId, 1);
  }

  // Build lookup maps for neighbours
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

// ── Algorithm 2: Hinge Centrality (Brandes' Algorithm) ────────────────────

/**
 * Calculates betweenness centrality adapted for directed scheme graphs.
 * Measures how often a node lies on shortest paths from leaf premises
 * to the focal conclusion node.
 *
 * Time complexity: O(V * E) via Brandes' algorithm.
 */
export function calculateHingeCentrality(
  nodeIds: string[],
  schemeEdges: SchemeEdge[]
): Map<string, number> {
  const betweenness = new Map<string, number>();
  for (const id of nodeIds) {
    betweenness.set(id, 0);
  }

  // Build adjacency list (directed: premise → conclusion)
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    adj.set(id, []);
  }
  for (const edge of schemeEdges) {
    if (nodeIds.includes(edge.from_node_id) && nodeIds.includes(edge.to_node_id)) {
      adj.get(edge.from_node_id)?.push(edge.to_node_id);
    }
  }

  // Brandes' algorithm
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

// ── Algorithm 3: K-Means Clustering ───────────────────────────────────────

/**
 * Simple K-Means clustering on high-dimensional embedding vectors.
 * Used to enforce viewpoint diversity in the final ranked output.
 * Returns cluster ID (0..k-1) for each node in the same order as `nodes`.
 */
export function kMeansClustering(
  embeddings: Array<number[] | null>,
  k: number,
  maxIterations: number = 50
): number[] {
  const n = embeddings.length;
  if (n === 0 || k <= 0) return [];
  if (k >= n) return embeddings.map((_, i) => i);

  // Filter to nodes that have embeddings; assign cluster 0 to those without
  const validIndices: number[] = [];
  const validEmbeddings: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (embeddings[i] !== null && embeddings[i]!.length > 0) {
      validIndices.push(i);
      validEmbeddings.push(embeddings[i]!);
    }
  }

  if (validEmbeddings.length === 0) {
    // No embeddings: assign round-robin clusters
    return embeddings.map((_, i) => i % k);
  }

  const dim = validEmbeddings[0]!.length;
  const assignments = new Array<number>(validEmbeddings.length).fill(0);

  // Initialize centroids by picking k spread-out starting points (kmeans++ style)
  const centroids: number[][] = [validEmbeddings[0]!.slice()];
  for (let c = 1; c < Math.min(k, validEmbeddings.length); c++) {
    const distances = validEmbeddings.map(v => {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const dist = cosineDist(v, centroid);
        if (dist < minDist) minDist = dist;
      }
      return minDist;
    });
    // Pick the point with highest min-distance to existing centroids
    let maxDist = -1;
    let pick = 0;
    for (let i = 0; i < distances.length; i++) {
      if (distances[i]! > maxDist) {
        maxDist = distances[i]!;
        pick = i;
      }
    }
    centroids.push(validEmbeddings[pick]!.slice());
  }

  const numClusters = centroids.length;

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assignment step
    for (let i = 0; i < validEmbeddings.length; i++) {
      let bestCluster = 0;
      let bestDist = Infinity;
      for (let c = 0; c < numClusters; c++) {
        const dist = cosineDist(validEmbeddings[i]!, centroids[c]!);
        if (dist < bestDist) {
          bestDist = dist;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    if (!changed) break;

    // Update step: recompute centroids
    for (let c = 0; c < numClusters; c++) {
      const members = validEmbeddings.filter((_, i) => assignments[i] === c);
      if (members.length > 0) {
        const newCentroid = new Array<number>(dim).fill(0);
        for (const v of members) {
          for (let d = 0; d < dim; d++) {
            newCentroid[d]! += v[d]!;
          }
        }
        for (let d = 0; d < dim; d++) {
          newCentroid[d]! /= members.length;
        }
        centroids[c] = newCentroid;
      }
    }
  }

  // Map assignments back to original indices
  const result = new Array<number>(n).fill(0);
  let validIdx = 0;
  for (let i = 0; i < n; i++) {
    if (embeddings[i] !== null && embeddings[i]!.length > 0) {
      result[i] = assignments[validIdx]!;
      validIdx++;
    } else {
      result[i] = 0;
    }
  }
  return result;
}

function cosineDist(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

// ── Combined Pipeline ──────────────────────────────────────────────────────

export interface PipelineResult {
  rankedNodes: RankedNode[];
  clustersFormed: number;
}

/**
 * Runs the full ranking pipeline:
 *   1. EvidenceRank
 *   2. HingeCentrality
 *   3. FinalScore = ER * (1 + log(1 + HC))
 *   4. Take top 100 by FinalScore
 *   5. K-Means cluster
 *   6. Pick top-scored node per cluster
 */
export function runRankingPipeline(
  nodes: SubgraphNode[],
  schemeEdges: SchemeEdge[],
  focalNodeId: string
): PipelineResult {
  if (nodes.length === 0) {
    return { rankedNodes: [], clustersFormed: 0 };
  }

  const allNodeIds = [focalNodeId, ...nodes.map(n => n.id)];

  // Step 1 & 2: Compute scores
  const evidenceRanks = calculateEvidenceRank(nodes, schemeEdges, focalNodeId);
  const hingeCentralities = calculateHingeCentrality(allNodeIds, schemeEdges);

  // Step 3: FinalScore
  const scored = nodes.map(node => {
    const er = evidenceRanks.get(node.id) ?? 0;
    const hc = hingeCentralities.get(node.id) ?? 0;
    const finalScore = er * (1 + Math.log(1 + hc));
    return { ...node, evidence_rank: er, hinge_centrality: hc, final_score: finalScore };
  });

  // Step 4: Sort + take top 100
  scored.sort((a, b) => b.final_score - a.final_score);
  const top100 = scored.slice(0, 100);

  if (top100.length === 0) {
    return { rankedNodes: [], clustersFormed: 0 };
  }

  // Step 5: K-Means clustering
  const k = Math.max(1, Math.min(10, Math.floor(Math.sqrt(top100.length))));
  const embeddings = top100.map(n => n.embedding);
  const clusterAssignments = kMeansClustering(embeddings, k);

  // Step 6: Assign clusters, then pick top per cluster
  const withClusters: RankedNode[] = top100.map((node, i) => ({
    ...node,
    cluster_id: clusterAssignments[i] ?? 0,
  }));

  // Pick best node per cluster, then collect remaining in score order
  const seenClusters = new Set<number>();
  const topPerCluster: RankedNode[] = [];
  const remaining: RankedNode[] = [];

  for (const node of withClusters) {
    if (!seenClusters.has(node.cluster_id)) {
      seenClusters.add(node.cluster_id);
      topPerCluster.push(node);
    } else {
      remaining.push(node);
    }
  }

  // Final list: top of each cluster first, then fill with remaining up to 30 total
  const finalNodes = [...topPerCluster, ...remaining].slice(0, 30);

  return {
    rankedNodes: finalNodes,
    clustersFormed: seenClusters.size,
  };
}

// ── Ghost Node Detection ───────────────────────────────────────────────────

export interface GhostNodeInput {
  id: string;
  scheme_id: string;
  content: string;
  fvp_type: string;
  probability: number;
  direction: 'SUPPORT' | 'ATTACK';
}

export interface SocraticQuestionInput {
  id: string;
  scheme_id: string;
  question: string;
  uncertainty_level: number;
}

export interface GhostNodeOutput {
  id: string;
  content: string;
  fvp_type: string;
  probability: number;
  scheme_id: string;
  scheme_direction: 'SUPPORT' | 'ATTACK';
  socratic_question: string | null;
  uncertainty_level: number;
}

/**
 * Identifies the most critical implicit assumption (enthymeme) in the
 * highest-ranked paths. Applies an artificial boost to surface the
 * Ghost Node at rank 0 in the Synthetic Global Thread.
 */
export function detectGhostNodes(
  rankedNodes: RankedNode[],
  enthymemes: GhostNodeInput[],
  socraticQuestions: SocraticQuestionInput[],
  maxGhosts: number = 3
): GhostNodeOutput[] {
  if (enthymemes.length === 0) return [];

  // Get the scheme IDs from the top-ranked nodes
  const topSchemeIds = new Set(rankedNodes.slice(0, 10).map(n => n.scheme_id));

  // Score ghost nodes by: probability * (1 if in top scheme, 0.5 otherwise)
  const socraticMap = new Map<string, SocraticQuestionInput>();
  for (const sq of socraticQuestions) {
    socraticMap.set(sq.scheme_id, sq);
  }

  const scoredGhosts = enthymemes
    .map(ghost => ({
      ...ghost,
      boost_score: ghost.probability * (topSchemeIds.has(ghost.scheme_id) ? 1.5 : 1.0),
    }))
    .sort((a, b) => b.boost_score - a.boost_score)
    .slice(0, maxGhosts);

  return scoredGhosts.map(ghost => {
    const sq = socraticMap.get(ghost.scheme_id);
    return {
      id: ghost.id,
      content: ghost.content,
      fvp_type: ghost.fvp_type,
      probability: ghost.probability,
      scheme_id: ghost.scheme_id,
      scheme_direction: ghost.direction,
      socratic_question: sq?.question ?? null,
      uncertainty_level: sq?.uncertainty_level ?? 0,
    };
  });
}
