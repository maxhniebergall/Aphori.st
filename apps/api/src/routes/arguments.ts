import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { createArgumentRepo } from '../db/repositories/ArgumentRepo.js';

const router = Router();

// GET /api/v1/arguments/posts/:id/adus - Get ADUs for a post
router.get('/posts/:id/adus', async (req, res) => {
  try {
    const pool = getPool();
    const argumentRepo = createArgumentRepo(pool);

    const adus = await argumentRepo.findBySource('post', req.params.id);

    res.json({ success: true, data: adus });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch ADUs' });
  }
});

// GET /api/v1/arguments/claims/:id - Get canonical claim details
router.get('/claims/:id', async (req, res) => {
  try {
    const pool = getPool();
    const argumentRepo = createArgumentRepo(pool);

    const claim = await argumentRepo.findCanonicalClaimById(req.params.id);

    if (!claim) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    res.json({ success: true, data: claim });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch claim' });
  }
});

// GET /api/v1/arguments/claims/:id/related - Get support/attack relations
router.get('/claims/:id/related', async (req, res) => {
  try {
    const pool = getPool();
    const argumentRepo = createArgumentRepo(pool);

    const relations = await argumentRepo.findRelationsByADU(req.params.id);

    res.json({ success: true, data: { relations } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch relations' });
  }
});

export default router;
