/**
 * Pure computation module for benchmark ranking algorithms.
 * No DB, no Express — importable from both API route and worker threads.
 */

import { EvidenceRankStrategy, applyHingeCentrality } from './EvidenceRankStrategy.js';
import { QuadraticEnergyStrategy } from './QuadraticEnergyStrategy.js';
import { DampedModularStrategy } from './DampedModularStrategy.js';
import type { GraphNode, GraphEdge, RankedResult } from './RankingStrategy.js';

// ── Serializable data types (safe for worker_threads postMessage) ──

export interface ThreadGraphNode {
  id: string;
  text: string;
  vote_score: number;
  source_id: string;
  source_type: 'post' | 'reply';
}

export interface ThreadGraphEdge {
  from_node_id: string;
  to_node_id: string;
  direction: 'SUPPORT' | 'ATTACK';
  confidence: number;
}

/** Map entries as tuples for structured-clone compatibility */
export interface SerializableThreadGraph {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
  nodeTargets: Array<[string, string[]]>;
}

export interface EnthymemeRow {
  id: string;
  content: string;
  probability: number;
  scheme_direction: 'SUPPORT' | 'ATTACK';
  source_type: 'post' | 'reply';
  source_id: string;
  conclusion_node_id: string | null;
}

export interface FlatRankedNode {
  id: string;
  text: string;
  rank: number;
  score: number;
  depth: number;
  parent_id: string | null;
  parent_text: string | null;
}

export interface BenchmarkComputeInput {
  threadGraph: SerializableThreadGraph;
  validEnthymemes: EnthymemeRow[];
  treeItems: unknown[];
  /** reply_id → number of direct child replies */
  replyChildCounts: Array<[string, number]>;
}

export interface BenchmarkComputeOutput {
  algTop: FlatRankedNode[];
  erVote: FlatRankedNode[];
  erVoteNB: FlatRankedNode[];
  erVote95: FlatRankedNode[];
  qeVote: FlatRankedNode[];
  qeVoteNB: FlatRankedNode[];
  dmRefBiasNB: FlatRankedNode[];
  dmVoteHCNB: FlatRankedNode[];
  combinedVote: FlatRankedNode[];
  erEnthInherit: FlatRankedNode[];
  erEnthAttack: FlatRankedNode[];
  erEnthSupport: FlatRankedNode[];
  erEnthInheritBridge: FlatRankedNode[];
  erEnthAttackBridge: FlatRankedNode[];
  erEnthSupportBridge: FlatRankedNode[];
  erEnthInheritW10: FlatRankedNode[];
  erEnthAttackW10: FlatRankedNode[];
  erEnthSupportW10: FlatRankedNode[];
  erEnthInheritWPct: FlatRankedNode[];
  erEnthAttackWPct: FlatRankedNode[];
  erEnthSupportWPct: FlatRankedNode[];
  erEnthInheritWPctConf: FlatRankedNode[];
  erEnthAttackWPctConf: FlatRankedNode[];
  erEnthSupportWPctConf: FlatRankedNode[];
  // Aggregation quick-win variants
  erVoteSum: FlatRankedNode[];
  erVoteSumNoDC: FlatRankedNode[];
  erVoteNoDC: FlatRankedNode[];
  erVoteDimNoDC: FlatRankedNode[];
  erVoteSumNoDCBridge: FlatRankedNode[];
  erVoteGeoNoDC: FlatRankedNode[];
  erVoteD95SumNoDC: FlatRankedNode[];
  // RRF combination variants
  rrfErQeVote: FlatRankedNode[];
  rrfErQeReply: FlatRankedNode[];
  // Reply count baselines
  topReplyCount: FlatRankedNode[];
  rrfTopVoteReplyCount: FlatRankedNode[];
  // Tree-reordered variants
  erVoteTree: unknown[];
  erVoteNBTree: unknown[];
  erVote95Tree: unknown[];
  qeVoteTree: unknown[];
  qeVoteNBTree: unknown[];
  dmRefBiasNBTree: unknown[];
  dmVoteHCNBTree: unknown[];
  combinedVoteTree: unknown[];
  enthymemeCount: number;
}

// ── Pure helper functions ──

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

interface InternalThreadGraph {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
  nodeTargets: Map<string, string[]>;
}

export function aggregateToReplyLevel(
  rankResults: RankedResult[],
  graph: InternalThreadGraph,
  bridgeCoeff: number
): FlatRankedNode[] {
  const degreeCentrality = new Map<string, number>();
  for (const e of graph.edges) {
    degreeCentrality.set(e.from_node_id, (degreeCentrality.get(e.from_node_id) ?? 0) + 1);
  }

  const nodeById = new Map<string, ThreadGraphNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  const replyScores = new Map<string, number>();
  for (const r of rankResults) {
    const node = nodeById.get(r.id);
    if (!node || node.source_type !== 'reply') continue;
    const dc = degreeCentrality.get(r.id) ?? 1;
    const nodeScore = r.score * Math.log(1 + dc);
    if (!replyScores.has(node.source_id) || nodeScore > replyScores.get(node.source_id)!) {
      replyScores.set(node.source_id, nodeScore);
    }
  }

  if (bridgeCoeff > 0) {
    const replyTargets = new Map<string, Set<string>>();
    for (const [iNodeId, conclusionIds] of graph.nodeTargets) {
      const node = nodeById.get(iNodeId);
      if (!node || node.source_type !== 'reply') continue;
      const targets = replyTargets.get(node.source_id) ?? new Set<string>();
      for (const cId of conclusionIds) targets.add(cId);
      replyTargets.set(node.source_id, targets);
    }
    for (const [replyId, baseScore] of replyScores) {
      const uniqueTargets = replyTargets.get(replyId)?.size ?? 1;
      const bridgeMultiplier = 1.0 + bridgeCoeff * (uniqueTargets - 1);
      replyScores.set(replyId, baseScore * bridgeMultiplier);
    }
  }

  const sorted = [...replyScores.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.map(([replyId, score], idx) => ({
    id: replyId,
    text: '',
    rank: idx + 1,
    score,
    depth: 0,
    parent_id: null,
    parent_text: null,
  }));
}

type AggMode = 'max' | 'sum' | 'diminishing' | 'geometric';
type DCMode = 'full' | 'none' | 'soft';

export function aggregateToReplyLevelV2(
  rankResults: RankedResult[],
  graph: InternalThreadGraph,
  bridgeCoeff: number,
  aggMode: AggMode = 'max',
  dcMode: DCMode = 'full'
): FlatRankedNode[] {
  const degreeCentrality = new Map<string, number>();
  for (const e of graph.edges) {
    degreeCentrality.set(e.from_node_id, (degreeCentrality.get(e.from_node_id) ?? 0) + 1);
  }

  const nodeById = new Map<string, ThreadGraphNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  // Collect all i-node scores per reply, applying DC mode
  const replyNodeScores = new Map<string, number[]>();
  for (const r of rankResults) {
    const node = nodeById.get(r.id);
    if (!node || node.source_type !== 'reply') continue;

    const dc = degreeCentrality.get(r.id) ?? 1;
    let nodeScore: number;
    switch (dcMode) {
      case 'full':
        nodeScore = r.score * Math.log(1 + dc);
        break;
      case 'none':
        nodeScore = r.score;
        break;
      case 'soft':
        nodeScore = r.score * (1 + 0.1 * Math.log(1 + dc));
        break;
    }

    const scores = replyNodeScores.get(node.source_id) ?? [];
    scores.push(nodeScore);
    replyNodeScores.set(node.source_id, scores);
  }

  // Aggregate scores per reply using aggMode
  const replyScores = new Map<string, number>();
  for (const [replyId, scores] of replyNodeScores) {
    let aggregated: number;
    switch (aggMode) {
      case 'max':
        aggregated = Math.max(...scores);
        break;
      case 'sum':
        aggregated = scores.reduce((a, b) => a + b, 0);
        break;
      case 'diminishing': {
        const maxVal = Math.max(...scores);
        const sumVal = scores.reduce((a, b) => a + b, 0);
        aggregated = maxVal + 0.3 * (sumVal - maxVal);
        break;
      }
      case 'geometric': {
        const product = scores.reduce((a, b) => a * b, 1);
        aggregated = Math.pow(product, 1 / scores.length);
        break;
      }
    }
    replyScores.set(replyId, aggregated);
  }

  // Apply bridge coefficient
  if (bridgeCoeff > 0) {
    const replyTargets = new Map<string, Set<string>>();
    for (const [iNodeId, conclusionIds] of graph.nodeTargets) {
      const node = nodeById.get(iNodeId);
      if (!node || node.source_type !== 'reply') continue;
      const targets = replyTargets.get(node.source_id) ?? new Set<string>();
      for (const cId of conclusionIds) targets.add(cId);
      replyTargets.set(node.source_id, targets);
    }
    for (const [replyId, baseScore] of replyScores) {
      const uniqueTargets = replyTargets.get(replyId)?.size ?? 1;
      const bridgeMultiplier = 1.0 + bridgeCoeff * (uniqueTargets - 1);
      replyScores.set(replyId, baseScore * bridgeMultiplier);
    }
  }

  const sorted = [...replyScores.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.map(([replyId, score], idx) => ({
    id: replyId,
    text: '',
    rank: idx + 1,
    score,
    depth: 0,
    parent_id: null,
    parent_text: null,
  }));
}

export function rrfCombine(rankings: RankedResult[][], k = 60): RankedResult[] {
  const scores = new Map<string, number>();
  const textById = new Map<string, string>();
  for (const ranking of rankings) {
    for (const r of ranking) {
      scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (k + r.rank));
      if (!textById.has(r.id)) textById.set(r.id, r.text);
    }
  }
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.map(([id, score], idx) => ({
    id,
    text: textById.get(id) ?? '',
    rank: idx + 1,
    score,
  }));
}

export function combineRankings(a: RankedResult[], b: RankedResult[]): RankedResult[] {
  if (a.length === 0 || b.length === 0) return [];
  const aScores = a.map(r => r.score);
  const bScores = b.map(r => r.score);
  const aMin = Math.min(...aScores), aMax = Math.max(...aScores);
  const bMin = Math.min(...bScores), bMax = Math.max(...bScores);
  const aRange = aMax - aMin || 1;
  const bRange = bMax - bMin || 1;

  const bNorm = new Map(b.map(r => [r.id, (r.score - bMin) / bRange]));
  const combined = a.map(r => ({
    ...r,
    score: ((r.score - aMin) / aRange) * (bNorm.get(r.id) ?? 0),
  }));
  combined.sort((x, y) => y.score - x.score);
  return combined.map((item, i) => ({ ...item, rank: i + 1 }));
}

export function reorderTree(items: unknown[], scoreMap: Map<string, number>): unknown[] {
  return [...(items as Array<Record<string, unknown>>)]
    .sort((a, b) => (scoreMap.get(b['id'] as string) ?? 0) - (scoreMap.get(a['id'] as string) ?? 0))
    .map(item => ({
      ...item,
      children: Array.isArray(item['children'])
        ? reorderTree(item['children'] as unknown[], scoreMap)
        : [],
    }));
}

// ── Main computation function ──

export function computeAllRankings(input: BenchmarkComputeInput): BenchmarkComputeOutput {
  const { validEnthymemes, treeItems } = input;

  // Deserialize nodeTargets from tuple array to Map
  const threadGraph: InternalThreadGraph = {
    nodes: input.threadGraph.nodes,
    edges: input.threadGraph.edges,
    nodeTargets: new Map<string, string[]>(),
  };
  for (const [k, v] of input.threadGraph.nodeTargets) {
    threadGraph.nodeTargets.set(k, v);
  }

  const graphEdges: GraphEdge[] = threadGraph.edges.map(e => ({
    from_node_id: e.from_node_id,
    to_node_id: e.to_node_id,
    direction: e.direction,
    confidence: e.confidence,
  }));

  const erStrategy = new EvidenceRankStrategy();
  const erStrategy95 = new EvidenceRankStrategy(0.95);
  const qeStrategy = new QuadraticEnergyStrategy();
  const dmStrategy = new DampedModularStrategy();

  const focalNodeId = threadGraph.nodes.find(n => n.source_type === 'post')?.id ?? '';

  function makeNodesER(getVoteScore: (n: ThreadGraphNode) => number): GraphNode[] {
    return threadGraph.nodes.map(n => ({
      id: n.id, text: n.text,
      basic_strength: sigmoid(n.vote_score),
      vote_score: getVoteScore(n),
      user_karma: 0,
    }));
  }

  function makeNodesQE(getVoteScore: (n: ThreadGraphNode) => number): GraphNode[] {
    return threadGraph.nodes.map(n => ({
      id: n.id, text: n.text,
      basic_strength: 0.5,
      vote_score: getVoteScore(n),
      user_karma: 0,
    }));
  }

  function makeNodesDM(getBasicStrength: (n: ThreadGraphNode) => number): GraphNode[] {
    return threadGraph.nodes.map(n => ({
      id: n.id, text: n.text,
      basic_strength: getBasicStrength(n),
      vote_score: 0,
      user_karma: 0,
    }));
  }

  const nodesER_Vote  = makeNodesER(n => Math.max(1, n.vote_score));
  const nodesQE_Vote  = makeNodesQE(n => Math.max(1, n.vote_score));
  const nodesDM_Vote  = makeNodesDM(n => sigmoid(Math.max(1, n.vote_score)));
  const nodesDM_RefBias = makeNodesDM(n => sigmoid(n.vote_score));

  const ranked_er_vote    = erStrategy.rank(nodesER_Vote, graphEdges, focalNodeId);
  const ranked_er_vote95  = erStrategy95.rank(nodesER_Vote, graphEdges, focalNodeId);
  const ranked_qe_vote    = qeStrategy.rank(nodesQE_Vote, graphEdges, focalNodeId);
  const ranked_dm_vote    = dmStrategy.rank(nodesDM_Vote, graphEdges, focalNodeId);
  const ranked_dm_refbias = dmStrategy.rank(nodesDM_RefBias, graphEdges, focalNodeId);

  const allNodeIds = [focalNodeId, ...threadGraph.nodes.map(n => n.id)];
  const ranked_dm_vote_hc = applyHingeCentrality(ranked_dm_vote, allNodeIds, graphEdges);

  // ── Enthymeme-augmented variants ──
  const graphNodeIds = new Set(threadGraph.nodes.map(n => n.id));
  const filteredEnthymemes = validEnthymemes.filter(
    e => e.conclusion_node_id != null && graphNodeIds.has(e.conclusion_node_id)
  );

  const maxVoteScore = Math.max(1, ...threadGraph.nodes.map(n => n.vote_score));

  function buildEnthymemeGraph(
    directionMode: 'inherit' | 'attack' | 'support',
    enthVoteScore: (e: EnthymemeRow) => number = () => 1,
  ): {
    nodes: GraphNode[]; edges: GraphEdge[]; augGraph: InternalThreadGraph;
  } {
    const extraNodes: ThreadGraphNode[] = filteredEnthymemes.map(e => ({
      id: e.id, text: e.content, vote_score: enthVoteScore(e),
      source_id: e.source_id,
      source_type: e.source_type as 'post' | 'reply',
    }));

    const extraEdges = filteredEnthymemes.map(e => ({
      from_node_id: e.id,
      to_node_id: e.conclusion_node_id!,
      direction: (directionMode === 'inherit' ? e.scheme_direction
        : directionMode === 'attack' ? 'ATTACK' : 'SUPPORT') as 'SUPPORT' | 'ATTACK',
      confidence: e.probability,
    }));

    const augNodeTargets = new Map<string, string[]>();
    threadGraph.nodeTargets.forEach((v, k) => augNodeTargets.set(k, v));
    for (const edge of extraEdges) {
      const existing = augNodeTargets.get(edge.from_node_id) ?? [];
      augNodeTargets.set(edge.from_node_id, [...existing, edge.to_node_id]);
    }

    const augGraph: InternalThreadGraph = {
      nodes: [...threadGraph.nodes, ...extraNodes],
      edges: [...threadGraph.edges, ...extraEdges],
      nodeTargets: augNodeTargets,
    };

    const nodes: GraphNode[] = augGraph.nodes.map(n => ({
      id: n.id, text: n.text,
      basic_strength: sigmoid(n.vote_score),
      vote_score: Math.max(1, n.vote_score),
      user_karma: 0,
    }));

    const edges: GraphEdge[] = augGraph.edges.map(e => ({
      from_node_id: e.from_node_id,
      to_node_id: e.to_node_id,
      direction: e.direction,
      confidence: e.confidence,
    }));

    return { nodes, edges, augGraph };
  }

  const enthInherit = buildEnthymemeGraph('inherit');
  const enthAttack  = buildEnthymemeGraph('attack');
  const enthSupport = buildEnthymemeGraph('support');

  const ranked_er_enth_inherit = erStrategy.rank(enthInherit.nodes, enthInherit.edges, focalNodeId);
  const ranked_er_enth_attack  = erStrategy.rank(enthAttack.nodes, enthAttack.edges, focalNodeId);
  const ranked_er_enth_support = erStrategy.rank(enthSupport.nodes, enthSupport.edges, focalNodeId);

  // Weight variant builders
  const w10     = () => 10;
  const wPct    = () => maxVoteScore * 0.01;
  const wPctConf = (e: EnthymemeRow) => maxVoteScore * 0.01 * e.probability;

  const enthInheritW10     = buildEnthymemeGraph('inherit', w10);
  const enthAttackW10      = buildEnthymemeGraph('attack',  w10);
  const enthSupportW10     = buildEnthymemeGraph('support', w10);
  const enthInheritWPct    = buildEnthymemeGraph('inherit', wPct);
  const enthAttackWPct     = buildEnthymemeGraph('attack',  wPct);
  const enthSupportWPct    = buildEnthymemeGraph('support', wPct);
  const enthInheritWPctConf = buildEnthymemeGraph('inherit', wPctConf);
  const enthAttackWPctConf  = buildEnthymemeGraph('attack',  wPctConf);
  const enthSupportWPctConf = buildEnthymemeGraph('support', wPctConf);

  const ranked_er_enth_inherit_w10      = erStrategy.rank(enthInheritW10.nodes, enthInheritW10.edges, focalNodeId);
  const ranked_er_enth_attack_w10       = erStrategy.rank(enthAttackW10.nodes, enthAttackW10.edges, focalNodeId);
  const ranked_er_enth_support_w10      = erStrategy.rank(enthSupportW10.nodes, enthSupportW10.edges, focalNodeId);
  const ranked_er_enth_inherit_wpct     = erStrategy.rank(enthInheritWPct.nodes, enthInheritWPct.edges, focalNodeId);
  const ranked_er_enth_attack_wpct      = erStrategy.rank(enthAttackWPct.nodes, enthAttackWPct.edges, focalNodeId);
  const ranked_er_enth_support_wpct     = erStrategy.rank(enthSupportWPct.nodes, enthSupportWPct.edges, focalNodeId);
  const ranked_er_enth_inherit_wpctconf = erStrategy.rank(enthInheritWPctConf.nodes, enthInheritWPctConf.edges, focalNodeId);
  const ranked_er_enth_attack_wpctconf  = erStrategy.rank(enthAttackWPctConf.nodes, enthAttackWPctConf.edges, focalNodeId);
  const ranked_er_enth_support_wpctconf = erStrategy.rank(enthSupportWPctConf.nodes, enthSupportWPctConf.edges, focalNodeId);

  // ── Aggregate to reply level ──
  const erVote       = aggregateToReplyLevel(ranked_er_vote, threadGraph, 1.0);
  const erVoteNB     = aggregateToReplyLevel(ranked_er_vote, threadGraph, 0.0);
  const erVote95     = aggregateToReplyLevel(ranked_er_vote95, threadGraph, 1.0);
  const qeVote       = aggregateToReplyLevel(ranked_qe_vote, threadGraph, 0.25);
  const qeVoteNB     = aggregateToReplyLevel(ranked_qe_vote, threadGraph, 0.0);
  const dmRefBiasNB  = aggregateToReplyLevel(ranked_dm_refbias, threadGraph, 0.0);
  const dmVoteHCNB   = aggregateToReplyLevel(ranked_dm_vote_hc, threadGraph, 0.0);
  const erEnthInherit = aggregateToReplyLevel(ranked_er_enth_inherit, enthInherit.augGraph, 0.0);
  const erEnthAttack  = aggregateToReplyLevel(ranked_er_enth_attack, enthAttack.augGraph, 0.0);
  const erEnthSupport = aggregateToReplyLevel(ranked_er_enth_support, enthSupport.augGraph, 0.0);
  const erEnthInheritBridge = aggregateToReplyLevel(ranked_er_enth_inherit, enthInherit.augGraph, 1.0);
  const erEnthAttackBridge  = aggregateToReplyLevel(ranked_er_enth_attack, enthAttack.augGraph, 1.0);
  const erEnthSupportBridge = aggregateToReplyLevel(ranked_er_enth_support, enthSupport.augGraph, 1.0);
  const erEnthInheritW10      = aggregateToReplyLevel(ranked_er_enth_inherit_w10, enthInheritW10.augGraph, 0.0);
  const erEnthAttackW10       = aggregateToReplyLevel(ranked_er_enth_attack_w10, enthAttackW10.augGraph, 0.0);
  const erEnthSupportW10      = aggregateToReplyLevel(ranked_er_enth_support_w10, enthSupportW10.augGraph, 0.0);
  const erEnthInheritWPct     = aggregateToReplyLevel(ranked_er_enth_inherit_wpct, enthInheritWPct.augGraph, 0.0);
  const erEnthAttackWPct      = aggregateToReplyLevel(ranked_er_enth_attack_wpct, enthAttackWPct.augGraph, 0.0);
  const erEnthSupportWPct     = aggregateToReplyLevel(ranked_er_enth_support_wpct, enthSupportWPct.augGraph, 0.0);
  const erEnthInheritWPctConf = aggregateToReplyLevel(ranked_er_enth_inherit_wpctconf, enthInheritWPctConf.augGraph, 0.0);
  const erEnthAttackWPctConf  = aggregateToReplyLevel(ranked_er_enth_attack_wpctconf, enthAttackWPctConf.augGraph, 0.0);
  const erEnthSupportWPctConf = aggregateToReplyLevel(ranked_er_enth_support_wpctconf, enthSupportWPctConf.augGraph, 0.0);
  const combinedVote  = aggregateToReplyLevel(combineRankings(ranked_er_vote, ranked_qe_vote), threadGraph, 1.0);

  // ── Aggregation quick-win variants (V2) ──
  const erVoteSum          = aggregateToReplyLevelV2(ranked_er_vote, threadGraph, 0.0, 'sum', 'full');
  const erVoteSumNoDC      = aggregateToReplyLevelV2(ranked_er_vote, threadGraph, 0.0, 'sum', 'none');
  const erVoteNoDC         = aggregateToReplyLevelV2(ranked_er_vote, threadGraph, 0.0, 'max', 'none');
  const erVoteDimNoDC      = aggregateToReplyLevelV2(ranked_er_vote, threadGraph, 0.0, 'diminishing', 'none');
  const erVoteSumNoDCBridge = aggregateToReplyLevelV2(ranked_er_vote, threadGraph, 1.0, 'sum', 'none');
  const erVoteGeoNoDC      = aggregateToReplyLevelV2(ranked_er_vote, threadGraph, 0.0, 'geometric', 'none');
  const erVoteD95SumNoDC   = aggregateToReplyLevelV2(ranked_er_vote95, threadGraph, 0.0, 'sum', 'none');

  // ── RRF combination variants ──
  const rrfErQeINode = rrfCombine([ranked_er_vote, ranked_qe_vote]);
  const rrfErQeVote  = aggregateToReplyLevelV2(rrfErQeINode, threadGraph, 0.0, 'sum', 'none');
  const rrfErQeReply = (() => {
    const erReply = aggregateToReplyLevelV2(ranked_er_vote, threadGraph, 0.0, 'sum', 'none');
    const qeReply = aggregateToReplyLevelV2(ranked_qe_vote, threadGraph, 0.0, 'sum', 'none');
    const erAsRanked: RankedResult[] = erReply.map(r => ({ id: r.id, text: r.text, rank: r.rank, score: r.score }));
    const qeAsRanked: RankedResult[] = qeReply.map(r => ({ id: r.id, text: r.text, rank: r.rank, score: r.score }));
    const rrfResult = rrfCombine([erAsRanked, qeAsRanked]);
    return rrfResult.map((r, idx) => ({
      id: r.id, text: r.text, rank: idx + 1, score: r.score,
      depth: 0, parent_id: null, parent_text: null,
    }));
  })();

  // Top baseline
  const topRanked: RankedResult[] = [...threadGraph.nodes]
    .sort((a, b) => Math.max(1, b.vote_score) - Math.max(1, a.vote_score))
    .map((n, i) => ({ id: n.id, text: n.text, rank: i + 1, score: Math.max(1, n.vote_score) }));
  const algTop = aggregateToReplyLevel(topRanked, threadGraph, 0.0);

  // Reply count baseline + RRF(Top_Vote, Top_ReplyCount)
  const childCounts = new Map(input.replyChildCounts);
  const replyIds = [...new Set(
    threadGraph.nodes.filter(n => n.source_type === 'reply').map(n => n.source_id)
  )];
  const topReplyCount: FlatRankedNode[] = [...replyIds]
    .map(id => ({ id, count: childCounts.get(id) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .map((r, idx) => ({
      id: r.id, text: '', rank: idx + 1, score: r.count,
      depth: 0, parent_id: null, parent_text: null,
    }));
  const topAsRanked: RankedResult[] = algTop.map(r => ({ id: r.id, text: '', rank: r.rank, score: r.score }));
  const rcAsRanked: RankedResult[] = topReplyCount.map(r => ({ id: r.id, text: '', rank: r.rank, score: r.score }));
  const rrfTopVoteReplyCount: FlatRankedNode[] = rrfCombine([topAsRanked, rcAsRanked])
    .map((r, idx) => ({
      id: r.id, text: '', rank: idx + 1, score: r.score,
      depth: 0, parent_id: null, parent_text: null,
    }));

  // ── Build tree variants ──
  const scoreMapErVote      = new Map(erVote.map(r => [r.id, r.score]));
  const scoreMapErVoteNB    = new Map(erVoteNB.map(r => [r.id, r.score]));
  const scoreMapErVote95    = new Map(erVote95.map(r => [r.id, r.score]));
  const scoreMapQeVote      = new Map(qeVote.map(r => [r.id, r.score]));
  const scoreMapQeVoteNB    = new Map(qeVoteNB.map(r => [r.id, r.score]));
  const scoreMapDmRefBiasNB = new Map(dmRefBiasNB.map(r => [r.id, r.score]));
  const scoreMapDmVoteHCNB  = new Map(dmVoteHCNB.map(r => [r.id, r.score]));
  const scoreMapCombined    = new Map(combinedVote.map(r => [r.id, r.score]));

  return {
    algTop,
    erVote, erVoteNB, erVote95,
    qeVote, qeVoteNB,
    dmRefBiasNB, dmVoteHCNB,
    combinedVote,
    erEnthInherit, erEnthAttack, erEnthSupport,
    erEnthInheritBridge, erEnthAttackBridge, erEnthSupportBridge,
    erEnthInheritW10, erEnthAttackW10, erEnthSupportW10,
    erEnthInheritWPct, erEnthAttackWPct, erEnthSupportWPct,
    erEnthInheritWPctConf, erEnthAttackWPctConf, erEnthSupportWPctConf,
    erVoteSum, erVoteSumNoDC, erVoteNoDC, erVoteDimNoDC,
    erVoteSumNoDCBridge, erVoteGeoNoDC, erVoteD95SumNoDC,
    rrfErQeVote, rrfErQeReply,
    topReplyCount, rrfTopVoteReplyCount,
    erVoteTree:      reorderTree(treeItems, scoreMapErVote),
    erVoteNBTree:    reorderTree(treeItems, scoreMapErVoteNB),
    erVote95Tree:    reorderTree(treeItems, scoreMapErVote95),
    qeVoteTree:      reorderTree(treeItems, scoreMapQeVote),
    qeVoteNBTree:    reorderTree(treeItems, scoreMapQeVoteNB),
    dmRefBiasNBTree: reorderTree(treeItems, scoreMapDmRefBiasNB),
    dmVoteHCNBTree:  reorderTree(treeItems, scoreMapDmVoteHCNB),
    combinedVoteTree: reorderTree(treeItems, scoreMapCombined),
    enthymemeCount: filteredEnthymemes.length,
  };
}
