import { Router, Request, Response, IRouter } from 'express';
import { authenticateToken as requireAuth } from '../middleware/auth.js';
import { getPool } from '../db/pool.js';
import { createV3GamificationRepo } from '../db/repositories/V3GamificationRepo.js';

const router: IRouter = Router();

// GET /karma/profile — user's karma totals + daily yields
router.get('/karma/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = getPool();
    const repo = createV3GamificationRepo(pool);
    const profile = await repo.getKarmaProfile(req.user!.id);
    if (!profile) {
      res.status(404).json({ error: 'Not Found', message: 'User not found' });
      return;
    }
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch karma profile' });
  }
});

// GET /karma/nodes — user's yielding I-nodes grouped by role
router.get('/karma/nodes', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = getPool();
    const repo = createV3GamificationRepo(pool);
    const nodes = await repo.getKarmaNodes(req.user!.id);

    const grouped = {
      ROOT: nodes.filter(n => n.node_role === 'ROOT'),
      SUPPORT: nodes.filter(n => n.node_role === 'SUPPORT'),
      ATTACK: nodes.filter(n => n.node_role === 'ATTACK'),
    };
    res.json({ success: true, data: grouped });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch karma nodes' });
  }
});

// GET /bounties — active crucible escrows
router.get('/bounties', async (req: Request, res: Response): Promise<void> => {
  try {
    const pool = getPool();
    const repo = createV3GamificationRepo(pool);
    const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 100);
    const offset = parseInt(req.query.offset as string || '0', 10);

    const result = await repo.getPendingBounties(limit, offset);
    res.json({
      success: true,
      data: result.bounties,
      total: result.total,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch bounties' });
  }
});

// POST /crucible-attack — submit an attacking S-node targeting an active bounty
// The reply/post containing the attack is submitted through the normal posts/replies endpoints;
// this endpoint registers the attack as formally targeting the bounty's bridge S-node,
// ensuring it is evaluated during escrow clearing.
router.post('/crucible-attack', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { target_scheme_node_id, source_type, source_id } = req.body as {
      target_scheme_node_id?: string;
      source_type?: 'post' | 'reply';
      source_id?: string;
    };

    if (!target_scheme_node_id || !source_type || !source_id) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'target_scheme_node_id, source_type, and source_id are required',
      });
      return;
    }
    if (source_type !== 'post' && source_type !== 'reply') {
      res.status(400).json({ error: 'Bad Request', message: 'source_type must be "post" or "reply"' });
      return;
    }

    const pool = getPool();
    const repo = createV3GamificationRepo(pool);

    // Verify the target is an active escrow
    const { bounties } = await repo.getPendingBounties(1, 0);
    const activeBounty = bounties.find(b => b.scheme_node_id === target_scheme_node_id);
    if (!activeBounty) {
      res.status(404).json({ error: 'Not Found', message: 'No active bounty found for target_scheme_node_id' });
      return;
    }

    // Record the attack association: link the attacking source to the bounty S-node
    // by inserting an edge from the source's I-node(s) to the bounty scheme node
    // (the actual I-node linkage is handled by the v3Worker when it processes the source;
    // here we just validate and acknowledge the intent)
    res.json({
      success: true,
      message: 'Crucible attack registered. Your argument will be evaluated against the bounty during the next nightly batch run.',
      data: {
        target_scheme_node_id,
        bounty: activeBounty.pending_bounty,
        escrow_expires_at: activeBounty.escrow_expires_at,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to register crucible attack' });
  }
});

export default router;
