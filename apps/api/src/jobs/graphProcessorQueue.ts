import { Queue } from 'bullmq';
import { createBullMQConnection } from './redisConnection.js';

const connection = createBullMQConnection('nightly-graph-processor');

export const graphProcessorQueue = new Queue('nightly-graph-processor', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 50,
    attempts: 1, // nightly job should not auto-retry on failure
  },
});

export async function closeGraphProcessorQueue(): Promise<void> {
  await graphProcessorQueue.close();
}
