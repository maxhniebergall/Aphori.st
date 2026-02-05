import { Router, type Router as RouterType } from 'express';
import { getPool } from '../db/pool.js';
import { createArgumentRepo } from '../db/repositories/ArgumentRepo.js';

const router: RouterType = Router();

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
      res.status(404).json({ success: false, error: 'Claim not found' });
      return;
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

// GET /api/v1/arguments/posts/:id/canonical-mappings - Get canonical claim mappings for a post's ADUs
router.get('/posts/:id/canonical-mappings', async (req, res) => {
  try {
    const pool = getPool();
    const argumentRepo = createArgumentRepo(pool);

    // Get all ADUs for this post
    const adus = await argumentRepo.findBySource('post', req.params.id);

    if (adus.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Get canonical mappings for these ADUs
    const aduIds = adus.map(adu => adu.id);
    const mappings = await argumentRepo.getCanonicalMappingsForADUs(aduIds);

    res.json({ success: true, data: mappings });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch canonical mappings' });
  }
});

// GET /api/v1/arguments/canonical-claims/:id/related-posts - Get posts containing this canonical claim
router.get('/canonical-claims/:id/related-posts', async (req, res) => {
  try {
    const pool = getPool();
    const argumentRepo = createArgumentRepo(pool);

    const limit = parseInt(req.query.limit as string) || 10;
    const excludeSourceId = req.query.exclude_source_id as string | undefined;

    const relatedPosts = await argumentRepo.getEnrichedSourcesForCanonicalClaim(
      req.params.id,
      limit,
      excludeSourceId
    );

    res.json({ success: true, data: relatedPosts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch related posts' });
  }
});

export default router;
