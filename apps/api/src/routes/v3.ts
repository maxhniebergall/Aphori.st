import { Router, type Router as RouterType } from 'express';
import { getPool } from '../db/pool.js';
import { createV3HypergraphRepo } from '../db/repositories/V3HypergraphRepo.js';
import { enqueueV3Analysis } from '../jobs/enqueueV3Analysis.js';
import { authenticateToken } from '../middleware/auth.js';

const router: RouterType = Router();

// POST /api/v1/v3/analyze — trigger V3 analysis (auth required)
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
    const pool = getPool();
    const table = source_type === 'post' ? 'posts' : 'replies';
    const result = await pool.query(`SELECT content FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [source_id]);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Source content not found' });
      return;
    }

    const jobId = await enqueueV3Analysis(source_type, source_id, result.rows[0].content);

    res.json({ success: true, data: { job_id: jobId } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to enqueue V3 analysis' });
  }
});

// GET /api/v1/v3/graph/:postId — full thread hypergraph
router.get('/graph/:postId', async (req, res) => {
  try {
    const pool = getPool();
    const v3Repo = createV3HypergraphRepo(pool);
    const subgraph = await v3Repo.getThreadSubgraph(req.params.postId);
    res.json({ success: true, data: subgraph });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch thread hypergraph' });
  }
});

// GET /api/v1/v3/source/:type/:id — per-source hypergraph
router.get('/source/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    if (type !== 'post' && type !== 'reply') {
      res.status(400).json({ success: false, error: 'type must be "post" or "reply"' });
      return;
    }

    const pool = getPool();
    const v3Repo = createV3HypergraphRepo(pool);
    const subgraph = await v3Repo.getSubgraphBySource(type, id);
    res.json({ success: true, data: subgraph });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch source hypergraph' });
  }
});

// GET /api/v1/v3/status/:type/:id — analysis run status
router.get('/status/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    if (type !== 'post' && type !== 'reply') {
      res.status(400).json({ success: false, error: 'type must be "post" or "reply"' });
      return;
    }

    const pool = getPool();
    const v3Repo = createV3HypergraphRepo(pool);
    const status = await v3Repo.getRunStatus(type, id);

    if (!status) {
      res.status(404).json({ success: false, error: 'No V3 analysis found for this source' });
      return;
    }

    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch analysis status' });
  }
});

export default router;
