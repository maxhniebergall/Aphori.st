import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Create a Redis connection configured for BullMQ with proper retry backoff.
 * Each caller gets its own connection (BullMQ requires separate connections
 * for queues, workers, and queue events).
 */
export function createBullMQConnection(label: string): Redis {
  const connection = new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      logger.warn(`Redis ${label}: reconnecting in ${delay}ms (attempt ${times})`);
      return delay;
    },
  });

  connection.on('error', (err) => {
    logger.error(`Redis ${label}: connection error`, { error: err.message });
  });

  connection.on('ready', () => {
    // Log host (but not password) so we can verify API and worker hit the same Redis
    const redactedUrl = config.redis.url.replace(/:\/\/:[^@]+@/, '://***@');
    logger.info(`Redis ${label}: connected`, { url: redactedUrl });
  });

  return connection;
}
