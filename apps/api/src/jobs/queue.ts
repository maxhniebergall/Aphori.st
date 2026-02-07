import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

export const argumentQueue = new Queue('argument-analysis', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 }, // Keep failures for 24h
  },
});

export const queueEvents = new QueueEvents('argument-analysis', { connection });

// Queue event listeners
queueEvents.on('completed', ({ jobId }) => {
  logger.info(`Job completed: ${jobId}`);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`Job failed: ${jobId}`, { reason: failedReason });
});

export async function closeQueue(): Promise<void> {
  await argumentQueue.close();
  await connection.quit();
}

export async function closeWorker(): Promise<void> {
  // Worker will be closed separately if it exists
}
