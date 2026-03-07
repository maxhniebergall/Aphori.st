import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { buildSyntheticThread, buildTopThread } from '../services/syntheticThreadService.js';
import { PostRepo } from '../db/repositories/index.js';
import { createV3HypergraphRepo } from '../db/repositories/V3HypergraphRepo.js';
import { getPool } from '../db/pool.js';
import { getArgumentService } from '../services/argumentService.js';
import { EvidenceRankStrategy } from '../services/experiments/EvidenceRankStrategy.js';
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
  withBridge: boolean
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

  if (withBridge) {
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
      const bridgeMultiplier = 1.0 + 0.5 * (uniqueTargets - 1);
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

    // Fetch existing 3 algorithms + thread graph in parallel
    const [algA, algB, algTop, threadGraph] = await Promise.all([
      buildSyntheticThread('post', postId, 100, undefined, 'evidence'),
      buildSyntheticThread('post', postId, 100, undefined, 'quadratic_energy'),
      buildTopThread(postId, 10000),
      repo.getThreadGraph(postId),
    ]);

    // Fetch LLM strength scores for all i_nodes in the thread
    let llmScores = new Map<string, number>();
    if (threadGraph.nodes.length > 0) {
      try {
        const argumentService = getArgumentService();
        llmScores = await argumentService.scoreArgumentStrength(
          threadGraph.nodes.map(n => ({ id: n.id, text: n.text }))
        );
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

    function makeNodesQE(getBasicStrength: (n: ThreadGraphNode) => number): GraphNode[] {
      return threadGraph.nodes.map(n => ({
        id: n.id,
        text: n.text,
        basic_strength: getBasicStrength(n),
        vote_score: n.vote_score,
        user_karma: 0,
      }));
    }

    // Reference bias weight: nightly-adjusted basic_strength already in the DB (sigmoid of adjusted vote)
    function refBiasStrength(n: ThreadGraphNode): number {
      return sigmoid(n.vote_score);
    }

    const nodesER_Vote  = makeNodesER(n => Math.max(1, n.vote_score));
    const nodesER_LLM   = makeNodesER(n => llmScores.get(n.id) ?? 0.5);
    const nodesQE_Vote  = makeNodesQE(n => sigmoid(Math.max(1, n.vote_score)));
    const nodesQE_LLM   = makeNodesQE(n => llmScores.get(n.id) ?? 0.5);
    const nodesDM_Vote  = makeNodesQE(n => sigmoid(Math.max(1, n.vote_score)));
    const nodesDM_LLM   = makeNodesQE(n => llmScores.get(n.id) ?? 0.5);
    const nodesDM_RefBias = makeNodesQE(refBiasStrength);

    // Run 7 strategy variants
    const [
      ranked_er_vote, ranked_er_llm,
      ranked_qe_vote, ranked_qe_llm,
      ranked_dm_vote, ranked_dm_llm, ranked_dm_refbias,
    ] = await Promise.all([
      Promise.resolve(erStrategy.rank(nodesER_Vote,    graphEdges, focalNodeId)),
      Promise.resolve(erStrategy.rank(nodesER_LLM,     graphEdges, focalNodeId)),
      Promise.resolve(qeStrategy.rank(nodesQE_Vote,    graphEdges, focalNodeId)),
      Promise.resolve(qeStrategy.rank(nodesQE_LLM,     graphEdges, focalNodeId)),
      Promise.resolve(dmStrategy.rank(nodesDM_Vote,    graphEdges, focalNodeId)),
      Promise.resolve(dmStrategy.rank(nodesDM_LLM,     graphEdges, focalNodeId)),
      Promise.resolve(dmStrategy.rank(nodesDM_RefBias, graphEdges, focalNodeId)),
    ]);

    // Aggregate to reply level with and without bridge (7 variants × 2 = 14)
    const erVote         = aggregateToReplyLevel(ranked_er_vote,    threadGraph, true);
    const erLlm          = aggregateToReplyLevel(ranked_er_llm,     threadGraph, true);
    const qeVote         = aggregateToReplyLevel(ranked_qe_vote,    threadGraph, true);
    const qeLlm          = aggregateToReplyLevel(ranked_qe_llm,     threadGraph, true);
    const dmVote         = aggregateToReplyLevel(ranked_dm_vote,    threadGraph, true);
    const dmLlm          = aggregateToReplyLevel(ranked_dm_llm,     threadGraph, true);
    const dmRefBias      = aggregateToReplyLevel(ranked_dm_refbias, threadGraph, true);
    const erVoteNB       = aggregateToReplyLevel(ranked_er_vote,    threadGraph, false);
    const erLlmNB        = aggregateToReplyLevel(ranked_er_llm,     threadGraph, false);
    const qeVoteNB       = aggregateToReplyLevel(ranked_qe_vote,    threadGraph, false);
    const qeLlmNB        = aggregateToReplyLevel(ranked_qe_llm,     threadGraph, false);
    const dmVoteNB       = aggregateToReplyLevel(ranked_dm_vote,    threadGraph, false);
    const dmLlmNB        = aggregateToReplyLevel(ranked_dm_llm,     threadGraph, false);
    const dmRefBiasNB    = aggregateToReplyLevel(ranked_dm_refbias, threadGraph, false);

    res.json({
      post_id: postId,
      parent_argument: post.content,
      evidence_rank: algA,
      quadratic_energy: algB,
      top: algTop,
      EvidenceRank_Vote:                    { items: erVote },
      EvidenceRank_Vote_NoBridge:           { items: erVoteNB },
      EvidenceRank_LLM:                     { items: erLlm },
      EvidenceRank_LLM_NoBridge:            { items: erLlmNB },
      QuadraticEnergy_Vote:                 { items: qeVote },
      QuadraticEnergy_Vote_NoBridge:        { items: qeVoteNB },
      QuadraticEnergy_LLM:                  { items: qeLlm },
      QuadraticEnergy_LLM_NoBridge:         { items: qeLlmNB },
      DampedModular_Vote:                   { items: dmVote },
      DampedModular_Vote_NoBridge:          { items: dmVoteNB },
      DampedModular_LLM:                    { items: dmLlm },
      DampedModular_LLM_NoBridge:           { items: dmLlmNB },
      DampedModular_ReferenceBias:          { items: dmRefBias },
      DampedModular_ReferenceBias_NoBridge: { items: dmRefBiasNB },
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
