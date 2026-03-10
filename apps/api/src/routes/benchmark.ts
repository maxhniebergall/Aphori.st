import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { buildTopThread } from '../services/syntheticThreadService.js';
import { PostRepo } from '../db/repositories/index.js';
import { createV3HypergraphRepo } from '../db/repositories/V3HypergraphRepo.js';
import { getPool } from '../db/pool.js';
import { computeAllRankings } from '../services/experiments/benchmarkCompute.js';
import type { SerializableThreadGraph, EnthymemeRow } from '../services/experiments/benchmarkCompute.js';
import logger from '../logger.js';
import type { ApiError } from '@chitin/shared';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /api/benchmark/thread/:postId
 *
 * Query params:
 *   graph_only=1  — Return raw graph data + enthymemes only (no ranking computation).
 *                    Used by runBenchmark.ts which computes rankings in worker threads.
 *   raw=1         — Include raw graph data alongside computed rankings (legacy mode).
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

    const graphOnly = req.query['graph_only'] === '1';

    // Fetch argument graph and enthymemes in parallel.
    // Skip expensive recursive buildTopThread in graph_only mode.
    const [algTopTree, threadGraph, enthymemeResult] = await Promise.all([
      graphOnly ? Promise.resolve(null) : buildTopThread(postId, 10000),
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

    // Filter enthymemes to those with a valid conclusion target in the graph
    const graphNodeIds = new Set(threadGraph.nodes.map(n => n.id));
    const validEnthymemes: EnthymemeRow[] = enthymemeResult.rows.filter(
      e => e.conclusion_node_id != null && graphNodeIds.has(e.conclusion_node_id)
    );

    // Serialize threadGraph for JSON response
    const serializedGraph: SerializableThreadGraph = {
      nodes: threadGraph.nodes,
      edges: threadGraph.edges,
      nodeTargets: [...threadGraph.nodeTargets.entries()],
    };

    // ── graph_only mode: return raw data, skip computation ──
    if (req.query['graph_only'] === '1') {
      res.json({
        post_id: postId,
        parent_argument: post.content,
        top_tree: algTopTree,
        graph: serializedGraph,
        enthymemes: validEnthymemes,
        enthymeme_count: validEnthymemes.length,
      });
      return;
    }

    // ── Full computation mode (backward-compatible) ──
    const treeItems = algTopTree!.items as unknown[];
    const result = computeAllRankings({
      threadGraph: serializedGraph,
      validEnthymemes,
      treeItems,
    });

    const includeRaw = req.query['raw'] === '1';
    const focalNodeId = threadGraph.nodes.find(n => n.source_type === 'post')?.id ?? '';
    const rawData = includeRaw ? {
      focalNodeId,
      nodes: threadGraph.nodes.map(n => ({
        id: n.id,
        vote_score: n.vote_score,
        source_type: n.source_type,
        source_id: n.source_id,
      })),
      edges: threadGraph.edges,
      nodeTargets: serializedGraph.nodeTargets,
    } : undefined;

    res.json({
      post_id: postId,
      parent_argument: post.content,
      top_tree:                             algTopTree,
      Top_Flat:                            { items: result.algTop },
      EvidenceRank_Vote:                   { items: result.erVote },
      EvidenceRank_Vote_Tree:              { items: result.erVoteTree },
      EvidenceRank_Vote_NoBridge:          { items: result.erVoteNB },
      EvidenceRank_Vote_NoBridge_Tree:     { items: result.erVoteNBTree },
      EvidenceRank_Vote_D95:               { items: result.erVote95 },
      EvidenceRank_Vote_D95_Tree:          { items: result.erVote95Tree },
      QuadraticEnergy_Vote:                { items: result.qeVote },
      QuadraticEnergy_Vote_Tree:           { items: result.qeVoteTree },
      QuadraticEnergy_Vote_NoBridge:       { items: result.qeVoteNB },
      QuadraticEnergy_Vote_NoBridge_Tree:  { items: result.qeVoteNBTree },
      DampedModular_ReferenceBias_NoBridge:      { items: result.dmRefBiasNB },
      DampedModular_ReferenceBias_NoBridge_Tree: { items: result.dmRefBiasNBTree },
      DampedModular_Vote_HC_NoBridge:            { items: result.dmVoteHCNB },
      DampedModular_Vote_HC_NoBridge_Tree:       { items: result.dmVoteHCNBTree },
      Combined_ER_QE_Vote:                 { items: result.combinedVote },
      Combined_ER_QE_Vote_Tree:            { items: result.combinedVoteTree },
      EvidenceRank_Enthymeme_Inherit:      { items: result.erEnthInherit },
      EvidenceRank_Enthymeme_Attack:       { items: result.erEnthAttack },
      EvidenceRank_Enthymeme_Support:      { items: result.erEnthSupport },
      EvidenceRank_Enthymeme_Inherit_Bridge: { items: result.erEnthInheritBridge },
      EvidenceRank_Enthymeme_Attack_Bridge:  { items: result.erEnthAttackBridge },
      EvidenceRank_Enthymeme_Support_Bridge: { items: result.erEnthSupportBridge },
      enthymeme_count: result.enthymemeCount,
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
