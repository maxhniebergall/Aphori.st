import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { buildTopThread } from '../services/syntheticThreadService.js';
import { PostRepo } from '../db/repositories/index.js';
import { createV3HypergraphRepo } from '../db/repositories/V3HypergraphRepo.js';
import { getPool } from '../db/pool.js';
import { EvidenceRankStrategy, applyHingeCentrality } from '../services/experiments/EvidenceRankStrategy.js';
import { QuadraticEnergyStrategy } from '../services/experiments/QuadraticEnergyStrategy.js';
import { DampedModularStrategy } from '../services/experiments/DampedModularStrategy.js';
import type { GraphNode, GraphEdge, RankedResult } from '../services/experiments/RankingStrategy.js';
import logger from '../logger.js';
import type { ApiError } from '@chitin/shared';

const router: ReturnType<typeof Router> = Router();

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

interface ThreadGraphNode {
  id: string;
  text: string;
  vote_score: number;
  source_id: string;
  source_type: 'post' | 'reply';
}

interface ThreadGraph {
  nodes: ThreadGraphNode[];
  edges: Array<{ from_node_id: string; to_node_id: string; direction: 'SUPPORT' | 'ATTACK'; confidence: number }>;
  nodeTargets: Map<string, string[]>;
}

interface FlatRankedNode {
  id: string;
  text: string;
  rank: number;
  score: number;
  depth: number;
  parent_id: string | null;
  parent_text: string | null;
}

function aggregateToReplyLevel(
  rankResults: RankedResult[],
  threadGraph: ThreadGraph,
  bridgeCoeff: number
): FlatRankedNode[] {
  // Build degree_centrality in-memory: count unique scheme edges per i_node as premise
  const degreeCentrality = new Map<string, number>();
  for (const e of threadGraph.edges) {
    degreeCentrality.set(e.from_node_id, (degreeCentrality.get(e.from_node_id) ?? 0) + 1);
  }

  const nodeById = new Map<string, ThreadGraphNode>();
  for (const n of threadGraph.nodes) nodeById.set(n.id, n);

  // For each i_node: nodeScore = strategy_score * log(1 + degree_centrality)
  // Group by reply (source_id), take max nodeScore per reply
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
    // Count unique conclusion targets per reply for bridge multiplier
    const replyTargets = new Map<string, Set<string>>();
    for (const [iNodeId, conclusionIds] of threadGraph.nodeTargets) {
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

/**
 * Combine two ranked result sets by normalizing each to [0,1] and multiplying.
 * ER and QE operate in very different score ranges (ER scales with vote magnitudes,
 * QE is sigmoid-bounded), so normalization is required before combining.
 * The product acts as an AND: both strategies must agree for a node to rank highly.
 */
function combineRankings(a: RankedResult[], b: RankedResult[]): RankedResult[] {
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

/**
 * Re-sort a nested thread tree at every level using a reply-ID → score map,
 * then DFS traversal gives the "tree rank" for that algorithm.
 */
function reorderTree(items: unknown[], scoreMap: Map<string, number>): unknown[] {
  return [...(items as Array<Record<string, unknown>>)]
    .sort((a, b) => (scoreMap.get(b['id'] as string) ?? 0) - (scoreMap.get(a['id'] as string) ?? 0))
    .map(item => ({
      ...item,
      children: Array.isArray(item['children'])
        ? reorderTree(item['children'] as unknown[], scoreMap)
        : [],
    }));
}

/**
 * GET /api/benchmark/thread/:postId
 * Returns all 10 algorithm results for a post.
 * Used by runBenchmark.ts for evaluation.
 */
router.get('/thread/:postId', authenticateToken, async (req: Request<{ postId: string }>, res: Response): Promise<void> => {
  try {
    const { postId } = req.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
      const apiError: ApiError = { error: 'Bad Request', message: 'Invalid post ID format' };
      res.status(400).json(apiError);
      return;
    }

    const post = await PostRepo.findByIdWithAuthor(postId);
    if (!post) {
      const apiError: ApiError = { error: 'Not Found', message: 'Post not found' };
      res.status(404).json(apiError);
      return;
    }

    const pool = getPool();
    const repo = createV3HypergraphRepo(pool);

    // Fetch vote-sorted thread tree, argument graph, and enthymemes in parallel
    const [algTopTree, threadGraph, enthymemeResult] = await Promise.all([
      buildTopThread(postId, 10000),
      repo.getThreadGraph(postId),
      pool.query<{
        id: string;
        content: string;
        probability: number;
        scheme_direction: 'SUPPORT' | 'ATTACK';
        source_type: 'post' | 'reply';
        source_id: string;
        conclusion_node_id: string | null;
      }>(`
        SELECT e.id, e.content, e.probability,
          s.direction as scheme_direction,
          ar.source_type, ar.source_id,
          ce.node_id as conclusion_node_id
        FROM v3_enthymemes e
        JOIN v3_nodes_s s ON s.id = e.scheme_id
        JOIN v3_analysis_runs ar ON ar.id = s.analysis_run_id
        LEFT JOIN v3_edges ce ON ce.scheme_node_id = s.id
          AND ce.role = 'conclusion' AND ce.node_type = 'i_node'
        WHERE (ar.source_type = 'post' AND ar.source_id = $1)
           OR (ar.source_type = 'reply' AND ar.source_id IN (
             SELECT id FROM replies WHERE post_id = $1 AND deleted_at IS NULL
           ))
      `, [postId]),
    ]);

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

    // Focal node = first post-sourced i_node (or empty string if none)
    const focalNodeId = threadGraph.nodes.find(n => n.source_type === 'post')?.id ?? '';

    // Build node sets for each weight variant
    function makeNodesER(getVoteScore: (n: ThreadGraphNode) => number): GraphNode[] {
      return threadGraph.nodes.map(n => ({
        id: n.id,
        text: n.text,
        basic_strength: sigmoid(n.vote_score),
        vote_score: getVoteScore(n),
        user_karma: 0,
      }));
    }

    // QE uses vote_score for its log-scaled prior (Phase 1); basic_strength is unused by QE.
    // DM uses basic_strength as its intrinsic weight w_i; vote_score is unused by DM.
    function makeNodesQE(getVoteScore: (n: ThreadGraphNode) => number): GraphNode[] {
      return threadGraph.nodes.map(n => ({
        id: n.id,
        text: n.text,
        basic_strength: 0.5,           // unused by QE
        vote_score: getVoteScore(n),
        user_karma: 0,
      }));
    }

    function makeNodesDM(getBasicStrength: (n: ThreadGraphNode) => number): GraphNode[] {
      return threadGraph.nodes.map(n => ({
        id: n.id,
        text: n.text,
        basic_strength: getBasicStrength(n),
        vote_score: 0,                 // unused by DM
        user_karma: 0,
      }));
    }

    const nodesER_Vote  = makeNodesER(n => Math.max(1, n.vote_score));
    const nodesQE_Vote  = makeNodesQE(n => Math.max(1, n.vote_score));
    const nodesDM_Vote  = makeNodesDM(n => sigmoid(Math.max(1, n.vote_score)));
    const nodesDM_RefBias = makeNodesDM(n => sigmoid(n.vote_score));

    // Run strategy variants. QE includes HC internally (Phase 3); DM does not.
    const [
      ranked_er_vote,
      ranked_er_vote95,
      ranked_qe_vote,
      ranked_dm_vote, ranked_dm_refbias,
    ] = await Promise.all([
      Promise.resolve(erStrategy.rank(nodesER_Vote,    graphEdges, focalNodeId)),
      Promise.resolve(erStrategy95.rank(nodesER_Vote,  graphEdges, focalNodeId)),
      Promise.resolve(qeStrategy.rank(nodesQE_Vote,    graphEdges, focalNodeId)),
      Promise.resolve(dmStrategy.rank(nodesDM_Vote,    graphEdges, focalNodeId)),
      Promise.resolve(dmStrategy.rank(nodesDM_RefBias, graphEdges, focalNodeId)),
    ]);

    // Apply HC to DM_Vote only (QE already has HC built-in via Phase 3)
    const allNodeIds = [focalNodeId, ...threadGraph.nodes.map(n => n.id)];
    const ranked_dm_vote_hc = applyHingeCentrality(ranked_dm_vote, allNodeIds, graphEdges);

    // ── Enthymeme-augmented EvidenceRank variants ──
    // Filter enthymemes to those with a valid conclusion target in the graph
    const graphNodeIds = new Set(threadGraph.nodes.map(n => n.id));
    const validEnthymemes = enthymemeResult.rows.filter(
      e => e.conclusion_node_id != null && graphNodeIds.has(e.conclusion_node_id)
    );

    const buildEnthymemeGraph = (
      directionMode: 'inherit' | 'attack' | 'support'
    ): { nodes: GraphNode[]; edges: GraphEdge[]; augGraph: ThreadGraph } => {
      const extraNodes: ThreadGraphNode[] = validEnthymemes.map(e => ({
        id: e.id,
        text: e.content,
        vote_score: 1,
        source_id: e.source_id,
        source_type: e.source_type as 'post' | 'reply',
      }));

      const extraEdges = validEnthymemes.map(e => ({
        from_node_id: e.id,
        to_node_id: e.conclusion_node_id!,
        direction: (directionMode === 'inherit' ? e.scheme_direction
          : directionMode === 'attack' ? 'ATTACK'
          : 'SUPPORT') as 'SUPPORT' | 'ATTACK',
        confidence: e.probability,
      }));

      const augNodeTargets = new Map<string, string[]>();
      threadGraph.nodeTargets.forEach((v, k) => augNodeTargets.set(k, v));
      for (const edge of extraEdges) {
        const existing = augNodeTargets.get(edge.from_node_id) ?? [];
        augNodeTargets.set(edge.from_node_id, [...existing, edge.to_node_id]);
      }

      const augGraph: ThreadGraph = {
        nodes: [...threadGraph.nodes, ...extraNodes],
        edges: [...threadGraph.edges, ...extraEdges],
        nodeTargets: augNodeTargets,
      };

      const nodes: GraphNode[] = augGraph.nodes.map(n => ({
        id: n.id,
        text: n.text,
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
    };

    const enthInherit = buildEnthymemeGraph('inherit');
    const enthAttack  = buildEnthymemeGraph('attack');
    const enthSupport = buildEnthymemeGraph('support');

    const ranked_er_enth_inherit = erStrategy.rank(enthInherit.nodes, enthInherit.edges, focalNodeId);
    const ranked_er_enth_attack  = erStrategy.rank(enthAttack.nodes,  enthAttack.edges,  focalNodeId);
    const ranked_er_enth_support = erStrategy.rank(enthSupport.nodes, enthSupport.edges, focalNodeId);

    // Aggregate to reply level — tuned bridge coefficients per variant
    // (0.0 = no bridge, tuned values from offline grid search)
    const erVote        = aggregateToReplyLevel(ranked_er_vote,    threadGraph, 1.0);
    const erVoteNB      = aggregateToReplyLevel(ranked_er_vote,    threadGraph, 0.0);
    const erVote95      = aggregateToReplyLevel(ranked_er_vote95,  threadGraph, 1.0);
    const qeVote        = aggregateToReplyLevel(ranked_qe_vote,    threadGraph, 0.25);
    const qeVoteNB      = aggregateToReplyLevel(ranked_qe_vote,    threadGraph, 0.0);
    const dmRefBiasNB   = aggregateToReplyLevel(ranked_dm_refbias, threadGraph, 0.0);
    const dmVoteHCNB    = aggregateToReplyLevel(ranked_dm_vote_hc, threadGraph, 0.0);

    // Enthymeme variants: NoBridge for clean comparison with EvidenceRank_Vote_NoBridge
    const erEnthInherit = aggregateToReplyLevel(ranked_er_enth_inherit, enthInherit.augGraph, 0.0);
    const erEnthAttack  = aggregateToReplyLevel(ranked_er_enth_attack,  enthAttack.augGraph,  0.0);
    const erEnthSupport = aggregateToReplyLevel(ranked_er_enth_support, enthSupport.augGraph, 0.0);

    // Combined ER×QE: normalize each to [0,1] then multiply (AND combination)
    const combinedVote  = aggregateToReplyLevel(combineRankings(ranked_er_vote, ranked_qe_vote), threadGraph, 1.0);

    // Top baseline: sort the same hypergraph nodes by vote score — identical
    // candidate set and aggregation pipeline as ER/QE/DM for a fair comparison.
    const topRanked: RankedResult[] = [...threadGraph.nodes]
      .sort((a, b) => Math.max(1, b.vote_score) - Math.max(1, a.vote_score))
      .map((n, i) => ({ id: n.id, text: n.text, rank: i + 1, score: Math.max(1, n.vote_score) }));
    const algTop = { items: aggregateToReplyLevel(topRanked, threadGraph, 0.0) };

    // Build score maps (reply ID → algorithm score) for tree re-ordering
    const scoreMapErVote     = new Map(erVote.map(r => [r.id, r.score]));
    const scoreMapErVoteNB   = new Map(erVoteNB.map(r => [r.id, r.score]));
    const scoreMapErVote95   = new Map(erVote95.map(r => [r.id, r.score]));
    const scoreMapQeVote     = new Map(qeVote.map(r => [r.id, r.score]));
    const scoreMapQeVoteNB   = new Map(qeVoteNB.map(r => [r.id, r.score]));
    const scoreMapDmRefBiasNB = new Map(dmRefBiasNB.map(r => [r.id, r.score]));
    const scoreMapDmVoteHCNB = new Map(dmVoteHCNB.map(r => [r.id, r.score]));
    const scoreMapCombined   = new Map(combinedVote.map(r => [r.id, r.score]));

    const treeItems = algTopTree.items as unknown[];

    const includeRaw = req.query['raw'] === '1';
    const rawData = includeRaw ? {
      focalNodeId,
      nodes: threadGraph.nodes.map(n => ({
        id: n.id,
        vote_score: n.vote_score,
        source_type: n.source_type,
        source_id: n.source_id,
      })),
      edges: threadGraph.edges,
      nodeTargets: [...threadGraph.nodeTargets.entries()],
    } : undefined;

    res.json({
      post_id: postId,
      parent_argument: post.content,
      top_tree:                             algTopTree,
      Top_Flat:                            { items: algTop.items },
      EvidenceRank_Vote:                   { items: erVote },
      EvidenceRank_Vote_Tree:              { items: reorderTree(treeItems, scoreMapErVote) },
      EvidenceRank_Vote_NoBridge:          { items: erVoteNB },
      EvidenceRank_Vote_NoBridge_Tree:     { items: reorderTree(treeItems, scoreMapErVoteNB) },
      EvidenceRank_Vote_D95:               { items: erVote95 },
      EvidenceRank_Vote_D95_Tree:          { items: reorderTree(treeItems, scoreMapErVote95) },
      QuadraticEnergy_Vote:                { items: qeVote },
      QuadraticEnergy_Vote_Tree:           { items: reorderTree(treeItems, scoreMapQeVote) },
      QuadraticEnergy_Vote_NoBridge:       { items: qeVoteNB },
      QuadraticEnergy_Vote_NoBridge_Tree:  { items: reorderTree(treeItems, scoreMapQeVoteNB) },
      DampedModular_ReferenceBias_NoBridge:      { items: dmRefBiasNB },
      DampedModular_ReferenceBias_NoBridge_Tree: { items: reorderTree(treeItems, scoreMapDmRefBiasNB) },
      DampedModular_Vote_HC_NoBridge:            { items: dmVoteHCNB },
      DampedModular_Vote_HC_NoBridge_Tree:       { items: reorderTree(treeItems, scoreMapDmVoteHCNB) },
      Combined_ER_QE_Vote:                 { items: combinedVote },
      Combined_ER_QE_Vote_Tree:            { items: reorderTree(treeItems, scoreMapCombined) },
      EvidenceRank_Enthymeme_Inherit:      { items: erEnthInherit },
      EvidenceRank_Enthymeme_Attack:       { items: erEnthAttack },
      EvidenceRank_Enthymeme_Support:      { items: erEnthSupport },
      enthymeme_count: validEnthymemes.length,
      ...(rawData !== undefined ? { raw_data: rawData } : {}),
    });
  } catch (error) {
    logger.error('Benchmark thread endpoint failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    const apiError: ApiError = { error: 'Internal Server Error', message: 'Failed to build benchmark thread' };
    res.status(500).json(apiError);
  }
});

export default router;
