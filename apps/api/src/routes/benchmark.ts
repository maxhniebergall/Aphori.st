import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { buildTopThread } from '../services/syntheticThreadService.js';
import { PostRepo } from '../db/repositories/index.js';
import { createV3HypergraphRepo } from '../db/repositories/V3HypergraphRepo.js';
import { getPool } from '../db/pool.js';
import { getArgumentService } from '../services/argumentService.js';
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

    const repo = createV3HypergraphRepo(getPool());

    // Fetch top-sorted thread + argument graph in parallel
    const [algTop, threadGraph] = await Promise.all([
      buildTopThread(postId, 10000),
      repo.getThreadGraph(postId),
    ]);

    // Fetch LLM strength scores — read cached values from DB first, only call
    // the discourse engine for nodes that haven't been scored yet.
    let llmScores = new Map<string, number>();
    if (threadGraph.nodes.length > 0) {
      try {
        const pool = getPool();
        const nodeIds = threadGraph.nodes.map(n => n.id);
        const cachedResult = await pool.query<{ id: string; llm_strength_score: string | null }>(
          `SELECT id, llm_strength_score FROM v3_nodes_i WHERE id = ANY($1)`,
          [nodeIds]
        );
        const uncachedNodes: Array<{ id: string; text: string }> = [];
        for (const row of cachedResult.rows) {
          if (row.llm_strength_score !== null) {
            llmScores.set(row.id, parseFloat(row.llm_strength_score));
          } else {
            const node = threadGraph.nodes.find(n => n.id === row.id);
            if (node) uncachedNodes.push({ id: node.id, text: node.text });
          }
        }

        if (uncachedNodes.length > 0) {
          logger.info(`LLM strength scoring ${uncachedNodes.length} uncached nodes (${llmScores.size} cached)`, {});
          const argumentService = getArgumentService();
          const freshScores = await argumentService.scoreArgumentStrength(uncachedNodes);
          for (const [id, score] of freshScores) {
            llmScores.set(id, score);
            // Persist to DB for future calls
            pool.query(`UPDATE v3_nodes_i SET llm_strength_score = $1 WHERE id = $2`, [score, id]).catch(() => {});
          }
        } else {
          logger.info(`LLM strength scores: all ${llmScores.size} nodes served from cache`, {});
        }
      } catch (err) {
        logger.warn('LLM strength scoring failed, defaulting to 0.5', {
          error: err instanceof Error ? err.message : String(err),
        });
        for (const n of threadGraph.nodes) llmScores.set(n.id, 0.5);
      }
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
    const nodesER_LLM   = makeNodesER(n => llmScores.get(n.id) ?? 0.5);
    // QE_Vote: log-scaled prior from raw CMV vote score
    // QE_LLM: LLM strength [0,1] mapped to [0,100] for meaningful log-spread in Phase 1
    const nodesQE_Vote  = makeNodesQE(n => Math.max(1, n.vote_score));
    const nodesQE_LLM   = makeNodesQE(n => Math.round((llmScores.get(n.id) ?? 0.5) * 100));
    const nodesDM_Vote  = makeNodesDM(n => sigmoid(Math.max(1, n.vote_score)));
    const nodesDM_LLM   = makeNodesDM(n => llmScores.get(n.id) ?? 0.5);
    const nodesDM_RefBias = makeNodesDM(n => sigmoid(n.vote_score));

    // Run 9 strategy variants. QE includes HC internally (Phase 3); DM does not.
    const [
      ranked_er_vote, ranked_er_llm,
      ranked_er_vote95, ranked_er_llm95,
      ranked_qe_vote, ranked_qe_llm,
      ranked_dm_vote, ranked_dm_llm, ranked_dm_refbias,
    ] = await Promise.all([
      Promise.resolve(erStrategy.rank(nodesER_Vote,    graphEdges, focalNodeId)),
      Promise.resolve(erStrategy.rank(nodesER_LLM,     graphEdges, focalNodeId)),
      Promise.resolve(erStrategy95.rank(nodesER_Vote,  graphEdges, focalNodeId)),
      Promise.resolve(erStrategy95.rank(nodesER_LLM,   graphEdges, focalNodeId)),
      Promise.resolve(qeStrategy.rank(nodesQE_Vote,    graphEdges, focalNodeId)),
      Promise.resolve(qeStrategy.rank(nodesQE_LLM,     graphEdges, focalNodeId)),
      Promise.resolve(dmStrategy.rank(nodesDM_Vote,    graphEdges, focalNodeId)),
      Promise.resolve(dmStrategy.rank(nodesDM_LLM,     graphEdges, focalNodeId)),
      Promise.resolve(dmStrategy.rank(nodesDM_RefBias, graphEdges, focalNodeId)),
    ]);

    // Apply HC to DM_Vote only (QE already has HC built-in via Phase 3)
    const allNodeIds = [focalNodeId, ...threadGraph.nodes.map(n => n.id)];
    const ranked_dm_vote_hc = applyHingeCentrality(ranked_dm_vote, allNodeIds, graphEdges);

    // Aggregate to reply level — tuned bridge coefficients per variant
    // (0.0 = no bridge, tuned values from offline grid search)
    const erVote        = aggregateToReplyLevel(ranked_er_vote,    threadGraph, 1.0);
    const erVoteNB      = aggregateToReplyLevel(ranked_er_vote,    threadGraph, 0.0);
    const erLlmNB       = aggregateToReplyLevel(ranked_er_llm,     threadGraph, 0.0);
    const erVote95      = aggregateToReplyLevel(ranked_er_vote95,  threadGraph, 1.0);
    const erLlm95       = aggregateToReplyLevel(ranked_er_llm95,   threadGraph, 0.0);
    const qeVote        = aggregateToReplyLevel(ranked_qe_vote,    threadGraph, 0.25);
    const qeVoteNB      = aggregateToReplyLevel(ranked_qe_vote,    threadGraph, 0.0);
    const qeLlm         = aggregateToReplyLevel(ranked_qe_llm,     threadGraph, 0.25);
    const qeLlmNB       = aggregateToReplyLevel(ranked_qe_llm,     threadGraph, 0.0);
    const dmLlm         = aggregateToReplyLevel(ranked_dm_llm,     threadGraph, 2.0);
    const dmRefBiasNB   = aggregateToReplyLevel(ranked_dm_refbias, threadGraph, 0.0);
    const dmVoteHCNB    = aggregateToReplyLevel(ranked_dm_vote_hc, threadGraph, 0.0);

    // Combined ER×QE: normalize each to [0,1] then multiply (AND combination)
    const combinedVote  = aggregateToReplyLevel(combineRankings(ranked_er_vote, ranked_qe_vote), threadGraph, 1.0);
    const combinedLlm   = aggregateToReplyLevel(combineRankings(ranked_er_llm,  ranked_qe_llm),  threadGraph, 0.0);

    const includeRaw = req.query['raw'] === '1';
    const rawData = includeRaw ? {
      focalNodeId,
      nodes: threadGraph.nodes.map(n => ({
        id: n.id,
        vote_score: n.vote_score,
        llm_score: llmScores.get(n.id) ?? 0.5,
        source_type: n.source_type,
        source_id: n.source_id,
      })),
      edges: threadGraph.edges,
      nodeTargets: [...threadGraph.nodeTargets.entries()],
    } : undefined;

    res.json({
      post_id: postId,
      parent_argument: post.content,
      top: algTop,
      ...(rawData !== undefined ? { raw_data: rawData } : {}),
      EvidenceRank_Vote:                    { items: erVote },
      EvidenceRank_Vote_NoBridge:           { items: erVoteNB },
      EvidenceRank_LLM_NoBridge:            { items: erLlmNB },
      QuadraticEnergy_Vote:                 { items: qeVote },
      QuadraticEnergy_Vote_NoBridge:        { items: qeVoteNB },
      QuadraticEnergy_LLM:                  { items: qeLlm },
      QuadraticEnergy_LLM_NoBridge:         { items: qeLlmNB },
      DampedModular_LLM:                    { items: dmLlm },
      DampedModular_ReferenceBias_NoBridge: { items: dmRefBiasNB },
      DampedModular_Vote_HC_NoBridge:       { items: dmVoteHCNB },
      EvidenceRank_Vote_D95:                { items: erVote95 },
      EvidenceRank_LLM_D95:                 { items: erLlm95 },
      Combined_ER_QE_Vote:                  { items: combinedVote },
      Combined_ER_QE_LLM:                   { items: combinedLlm },
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
