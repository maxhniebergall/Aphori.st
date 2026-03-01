import { timingSafeEqual } from 'node:crypto';
import { Router, Request, Response, IRouter } from 'express';
import { config } from '../config.js';
import { blockIP, getBlockedIPs } from '../middleware/ipBlocklist.js';

const MAX_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function secretMatch(provided: string): boolean {
  const expected = config.internalSecret;
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

const router: IRouter = Router();

// Guard: all /internal routes require the shared secret
router.use((req: Request, res: Response, next) => {
  const provided = req.headers['x-internal-secret'];
  if (typeof provided !== 'string' || !secretMatch(provided)) {
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
  let validatedTtl: number | undefined;
  if (ttlSeconds !== undefined) {
    if (
      typeof ttlSeconds !== 'number' ||
      !Number.isFinite(ttlSeconds) ||
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds <= 0 ||
      ttlSeconds > MAX_TTL_SECONDS
    ) {
      res.status(400).json({ error: `ttlSeconds must be a positive integer no greater than ${MAX_TTL_SECONDS}` });
      return;
    }
    validatedTtl = ttlSeconds;
  }
  await blockIP(ip, validatedTtl);
  res.json({ ok: true });
});

// GET /internal/blocked-ips
// Returns the current set of blocked IPs so newly-spun-up web instances
// can warm their local cache on startup.
router.get('/blocked-ips', async (_req: Request, res: Response): Promise<void> => {
  const ips = await getBlockedIPs();
  res.json({ ips });
});

// POST /internal/trigger-nightly-graph-processor
// Dev/ops endpoint to manually trigger the nightly graph processing batch.
router.post('/trigger-nightly-graph-processor', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { graphProcessorQueue } = await import('../jobs/graphProcessorQueue.js');
    const job = await graphProcessorQueue.add('manual-trigger', {}, {
      jobId: `manual-nightly-${Date.now()}`,
    });
    res.json({ ok: true, jobId: job.id });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
