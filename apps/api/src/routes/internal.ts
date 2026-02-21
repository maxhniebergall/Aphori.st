import { Router, Request, Response, IRouter } from 'express';
import { config } from '../config.js';
import { blockIP, getBlockedIPs } from '../middleware/ipBlocklist.js';

const router: IRouter = Router();

// Guard: all /internal routes require the shared secret
router.use((req: Request, res: Response, next) => {
  if (req.headers['x-internal-secret'] !== config.internalSecret) {
    res.status(404).end(); // Return 404, not 401, to avoid disclosing endpoint existence
    return;
  }
  next();
});

// POST /internal/block-ip
// Body: { ip: string, ttlSeconds?: number }
// Called by the Next.js middleware when it detects a scanner, so the block
// is persisted to Redis and picked up by all API and web instances.
router.post('/block-ip', async (req: Request, res: Response): Promise<void> => {
  const { ip, ttlSeconds } = req.body as { ip?: string; ttlSeconds?: number };
  if (!ip || typeof ip !== 'string') {
    res.status(400).json({ error: 'ip is required' });
    return;
  }
  await blockIP(ip, typeof ttlSeconds === 'number' ? ttlSeconds : undefined);
  res.json({ ok: true });
});

// GET /internal/blocked-ips
// Returns the current set of blocked IPs so newly-spun-up web instances
// can warm their local cache on startup.
router.get('/blocked-ips', async (_req: Request, res: Response): Promise<void> => {
  const ips = await getBlockedIPs();
  res.json({ ips });
});

export default router;
