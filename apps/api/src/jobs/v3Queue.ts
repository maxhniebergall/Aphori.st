import { Queue, QueueEvents } from 'bullmq';
import { logger } from '../utils/logger.js';
import { createBullMQConnection } from './redisConnection.js';

const connection = createBullMQConnection('v3-queue');
const eventsConnection = createBullMQConnection('v3-queue-events');

export const v3Queue = new Queue('v3-analysis', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
  },
});

export const v3QueueEvents = new QueueEvents('v3-analysis', { connection: eventsConnection });

v3QueueEvents.on('completed', ({ jobId }) => {
  logger.info(`V3 job completed: ${jobId}`);
});

v3QueueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`V3 job failed: ${jobId}`, { reason: failedReason });
});

export async function closeV3Queue(): Promise<void> {
  await v3QueueEvents.close();
  await v3Queue.close();
  await eventsConnection.quit();
  await connection.quit();
}
