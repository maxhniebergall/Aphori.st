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
    const parsedLimit = parseInt(req.query.limit as string || '20', 10);
    const parsedOffset = parseInt(req.query.offset as string || '0', 10);
    const limit = Math.min(isNaN(parsedLimit) || parsedLimit < 0 ? 20 : parsedLimit, 100);
    const offset = isNaN(parsedOffset) || parsedOffset < 0 ? 0 : parsedOffset;

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

export default router;
