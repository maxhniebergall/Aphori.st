import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const KEY_PREFIX = 'ip_block:';
const DEFAULT_TTL_S = 86400; // 24 hours

// Lazy singleton - only created when first request arrives
let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redis.url, {
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    redis.on('error', (err) =>
      logger.warn('ip-blocklist redis error', { error: err.message }),
    );
  }
  return redis;
}

// ─── Local in-process cache ───────────────────────────────────────────────────
// Prevents a Redis roundtrip on every request for known-bad IPs.
// Cache entries expire after 60 s so newly-unblocked IPs are released promptly.
const localCache = new Map<string, { blocked: boolean; expiresAt: number }>();
const LOCAL_TTL_MS = 60_000;

async function checkBlocked(ip: string): Promise<boolean> {
  const cached = localCache.get(ip);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.blocked;
  }

  try {
    const result = await getRedis().exists(`${KEY_PREFIX}${ip}`);
    const blocked = result === 1;
    localCache.set(ip, { blocked, expiresAt: Date.now() + LOCAL_TTL_MS });
    return blocked;
  } catch {
    // Fail open — don't block valid traffic when Redis is unavailable
    return false;
  }
}

export async function blockIP(ip: string, ttlSeconds = DEFAULT_TTL_S): Promise<void> {
  try {
    await getRedis().setex(`${KEY_PREFIX}${ip}`, ttlSeconds, '1');
    localCache.set(ip, { blocked: true, expiresAt: Date.now() + LOCAL_TTL_MS });
    logger.debug('IP blocked', { ip, ttlSeconds });
  } catch (err) {
    logger.warn('Failed to block IP in Redis', {
      ip,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getBlockedIPs(): Promise<string[]> {
  const redisClient = getRedis();
  const pattern = `${KEY_PREFIX}*`;
  const blocked: string[] = [];
  let cursor = '0';
  try {
    do {
      const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        blocked.push(key.slice(KEY_PREFIX.length));
      }
    } while (cursor !== '0');
    return blocked;
  } catch {
    return [];
  }
}

export async function ipBlocklistMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  if (!ip) { next(); return; }

  const blocked = await checkBlocked(ip);
  if (blocked) {
    res.status(404).end();
    return;
  }

  next();
}
