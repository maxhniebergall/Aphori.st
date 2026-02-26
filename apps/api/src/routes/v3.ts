import { Router, type Router as RouterType } from 'express';
import { getPool } from '../db/pool.js';
import { createV3HypergraphRepo } from '../db/repositories/V3HypergraphRepo.js';
import { PostRepo } from '../db/repositories/PostRepo.js';
import { ReplyRepo } from '../db/repositories/ReplyRepo.js';
import { enqueueV3Analysis } from '../jobs/enqueueV3Analysis.js';
import { authenticateToken } from '../middleware/auth.js';
import { combinedRateLimiter } from '../middleware/rateLimit.js';
import { logger } from '../utils/logger.js';
import {
  runRankingPipeline,
  detectGhostNodes,
  type SubgraphNode,
} from '../services/investigateService.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: RouterType = Router();

// POST /api/v3/analyze — trigger V3 analysis (auth required)
router.post('/analyze', authenticateToken, async (req, res) => {
  try {
    const { source_type, source_id } = req.body;

    if (!source_type || !source_id) {
      res.status(400).json({ success: false, error: 'source_type and source_id are required' });
      return;
    }

    if (source_type !== 'post' && source_type !== 'reply') {
      res.status(400).json({ success: false, error: 'source_type must be "post" or "reply"' });
      return;
    }

    // Fetch content to compute hash
    const contentRecord = source_type === 'post'
      ? await PostRepo.findById(source_id)
      : await ReplyRepo.findById(source_id);

    if (!contentRecord) {
      res.status(404).json({ success: false, error: 'Source content not found' });
      return;
    }

    const jobId = await enqueueV3Analysis(source_type, source_id, contentRecord.content);

    res.json({ success: true, data: { job_id: jobId } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to enqueue V3 analysis' });
  }
});

// GET /api/v3/graph/:postId — full thread hypergraph
router.get('/graph/:postId', async (req, res) => {
  if (!UUID_RE.test(req.params.postId)) {
    res.status(400).json({ success: false, error: 'Invalid post ID format' });
    return;
  }
  try {
    const pool = getPool();
    const v3Repo = createV3HypergraphRepo(pool);
    const subgraph = await v3Repo.getThreadSubgraph(req.params.postId);
    res.json({ success: true, data: subgraph });
  } catch (error) {
    logger.error('Failed to fetch thread hypergraph', { postId: req.params.postId, error });
    res.status(500).json({ success: false, error: 'Failed to fetch thread hypergraph' });
  }
});

// GET /api/v3/source/:type/:id — per-source hypergraph
router.get('/source/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  if (type !== 'post' && type !== 'reply') {
    res.status(400).json({ success: false, error: 'type must be "post" or "reply"' });
    return;
  }
  if (!UUID_RE.test(id)) {
    res.status(400).json({ success: false, error: 'Invalid ID format' });
    return;
  }
  try {
    const pool = getPool();
    const v3Repo = createV3HypergraphRepo(pool);
    const subgraph = await v3Repo.getSubgraphBySource(type, id);
    res.json({ success: true, data: subgraph });
  } catch (error) {
    logger.error('Failed to fetch source hypergraph', { type, id, error });
    res.status(500).json({ success: false, error: 'Failed to fetch source hypergraph' });
  }
});

// GET /api/v3/status/:type/:id — analysis run status
router.get('/status/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  if (type !== 'post' && type !== 'reply') {
    res.status(400).json({ success: false, error: 'type must be "post" or "reply"' });
    return;
  }
  if (!UUID_RE.test(id)) {
    res.status(400).json({ success: false, error: 'Invalid ID format' });
    return;
  }
  try {
    const pool = getPool();
    const v3Repo = createV3HypergraphRepo(pool);
    const status = await v3Repo.getRunStatus(type, id);

    if (!status) {
      res.status(404).json({ success: false, error: 'No V3 analysis found for this source' });
      return;
    }

    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('Failed to fetch analysis status', { type, id, error });
    res.status(500).json({ success: false, error: 'Failed to fetch analysis status' });
  }
});

// GET /api/v3/similar/:iNodeId — find similar I-nodes across the network
router.get('/similar/:iNodeId', combinedRateLimiter, async (req, res) => {
  const iNodeId = req.params['iNodeId'];
  if (typeof iNodeId !== 'string' || !UUID_RE.test(iNodeId)) {
    res.status(400).json({ success: false, error: 'Invalid I-node ID format' });
    return;
  }
  try {
    const pool = getPool();
    const v3Repo = createV3HypergraphRepo(pool);

    // Look up the I-node's embedding
    const nodeResult = await pool.query(
      `SELECT id, embedding FROM v3_nodes_i WHERE id = $1`,
      [iNodeId]
    );

    if (nodeResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'I-node not found' });
      return;
    }

    const embedding = nodeResult.rows[0].embedding;
    if (!embedding) {
      res.json({ success: true, data: { similar_nodes: [] } });
      return;
    }

    const similar = await v3Repo.findSimilarINodes(embedding, 0.75, 10);

    // Exclude the queried node and join source info
    const filtered = similar.filter(n => n.id !== iNodeId);

    // Batch-enrich with source post/reply info
    const postIds = filtered.filter(n => n.source_type === 'post').map(n => n.source_id);
    const replyIds = filtered.filter(n => n.source_type === 'reply').map(n => n.source_id);

    const [postRows, replyRows] = await Promise.all([
      postIds.length ? pool.query(
        `SELECT p.id, p.title, u.display_name, u.id as user_id
         FROM posts p JOIN users u ON p.author_id = u.id
         WHERE p.id = ANY($1) AND p.deleted_at IS NULL`,
        [postIds]
      ) : { rows: [] as any[] },
      replyIds.length ? pool.query(
        `SELECT r.id, r.post_id, p.title, u.display_name, u.id as user_id
         FROM replies r JOIN posts p ON r.post_id = p.id JOIN users u ON r.author_id = u.id
         WHERE r.id = ANY($1) AND r.deleted_at IS NULL`,
        [replyIds]
      ) : { rows: [] as any[] },
    ]);

    const postMap = new Map(postRows.rows.map(r => [r.id, r]));
    const replyMap = new Map(replyRows.rows.map(r => [r.id, r]));

    const enriched = filtered.map(node => {
      const row = node.source_type === 'post'
        ? postMap.get(node.source_id)
        : replyMap.get(node.source_id);
      return {
        i_node: node,
        similarity: node.similarity,
        source_title: row?.title ?? null,
        source_post_id: node.source_type === 'post' ? (row?.id ?? null) : (row?.post_id ?? null),
        source_author: row?.display_name || row?.user_id || null,
      };
    });

    res.json({ success: true, data: { similar_nodes: enriched } });
  } catch (error) {
    logger.error('Failed to find similar I-nodes', { error });
    res.status(500).json({ success: false, error: 'Failed to find similar I-nodes' });
  }
});

// GET /api/v3/investigate/:iNodeId — Synthetic Global Thread
router.get('/investigate/:iNodeId', combinedRateLimiter, async (req, res) => {
  const iNodeId = req.params['iNodeId'];
  if (typeof iNodeId !== 'string' || !UUID_RE.test(iNodeId)) {
    res.status(400).json({ success: false, error: 'Invalid I-node ID format' });
    return;
  }

  try {
    const pool = getPool();
    const v3Repo = createV3HypergraphRepo(pool);

    // 1. Fetch the focal I-node
    const focalNode = await v3Repo.getINodeById(iNodeId);
    if (!focalNode) {
      res.status(404).json({ success: false, error: 'I-node not found' });
      return;
    }

    // Fetch focal node source info
    const [focalPostRow, focalReplyRow] = await Promise.all([
      focalNode.source_type === 'post'
        ? pool.query(
            `SELECT p.id, p.title, u.display_name, u.id as user_id
             FROM posts p JOIN users u ON p.author_id = u.id
             WHERE p.id = $1 AND p.deleted_at IS NULL`,
            [focalNode.source_id]
          )
        : Promise.resolve({ rows: [] as { id: string; title: string; display_name: string; user_id: string }[] }),
      focalNode.source_type === 'reply'
        ? pool.query(
            `SELECT r.id, r.post_id, p.title, u.display_name, u.id as user_id
             FROM replies r
             JOIN posts p ON r.post_id = p.id
             JOIN users u ON r.author_id = u.id
             WHERE r.id = $1 AND r.deleted_at IS NULL`,
            [focalNode.source_id]
          )
        : Promise.resolve({ rows: [] as { id: string; post_id: string; title: string; display_name: string; user_id: string }[] }),
    ]);

    const focalSourceRow = focalNode.source_type === 'post'
      ? focalPostRow.rows[0]
      : focalReplyRow.rows[0];

    const focalData = {
      id: focalNode.id,
      content: focalNode.content,
      rewritten_text: focalNode.rewritten_text,
      epistemic_type: focalNode.epistemic_type,
      fvp_confidence: focalNode.fvp_confidence,
      source_type: focalNode.source_type,
      source_id: focalNode.source_id,
      source_post_id: focalNode.source_type === 'post'
        ? (focalSourceRow?.id ?? focalNode.source_id)
        : ((focalSourceRow as { post_id?: string })?.post_id ?? focalNode.source_id),
      source_title: focalSourceRow?.title ?? null,
      source_author: focalSourceRow?.display_name ?? null,
      source_author_id: focalSourceRow?.user_id ?? null,
    };

    // 2. Get the investigate subgraph
    const subgraph = await v3Repo.getInvestigateSubgraph(iNodeId);

    // 3. Attach extracted values to nodes
    const nodesWithValues: SubgraphNode[] = subgraph.relatedNodes.map(node => ({
      ...node,
      extracted_values: subgraph.extractedValues.get(node.id) ?? [],
    }));

    // 4. Run the ranking pipeline
    const { rankedNodes, clustersFormed } = runRankingPipeline(
      nodesWithValues,
      subgraph.schemeEdges,
      iNodeId
    );

    // 5. Detect ghost nodes
    const ghostNodes = detectGhostNodes(
      rankedNodes,
      subgraph.enthymemes,
      subgraph.socraticQuestions
    );

    // 6. Build the response
    const syntheticThread = rankedNodes.map(node => ({
      i_node_id: node.id,
      content: node.content,
      rewritten_text: node.rewritten_text,
      epistemic_type: node.epistemic_type,
      fvp_confidence: node.fvp_confidence,
      source_type: node.source_type,
      source_id: node.source_id,
      source_post_id: node.source_post_id,
      source_title: node.source_title,
      source_author: node.source_author,
      source_author_id: node.source_author_id,
      relation: node.direction,
      scheme_id: node.scheme_id,
      scheme_confidence: node.scheme_confidence,
      evidence_rank: node.evidence_rank,
      hinge_centrality: node.hinge_centrality,
      final_score: node.final_score,
      cluster_id: node.cluster_id,
      extracted_values: node.extracted_values,
    }));

    res.json({
      success: true,
      data: {
        focal_node: focalData,
        synthetic_thread: syntheticThread,
        ghost_nodes: ghostNodes,
        total_related: subgraph.relatedNodes.length,
        computation_metadata: {
          nodes_analyzed: subgraph.relatedNodes.length,
          clusters_formed: clustersFormed,
        },
      },
    });
  } catch (error) {
    logger.error('Failed to generate investigate page', { iNodeId, error });
    res.status(500).json({ success: false, error: 'Failed to generate investigate page' });
  }
});

export default router;
