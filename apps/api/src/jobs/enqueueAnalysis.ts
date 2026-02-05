import crypto from 'crypto';
import { argumentQueue } from './queue.js';
import { logger } from '../utils/logger.js';

export async function enqueueAnalysis(
  sourceType: 'post' | 'reply',
  sourceId: string,
  content: string
): Promise<void> {
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');

  const jobId = `${sourceType}-${sourceId}-${contentHash.substring(0, 8)}`;

  // Retry on transient failures with exponential backoff
  // Max 5 attempts: immediate, 1s, 2s, 4s, 8s delays
  await argumentQueue.add('analyze', { sourceType, sourceId, contentHash }, {
    jobId,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000, // 1 second base delay
    },
  });

  logger.info(`Enqueued analysis job: ${jobId}`, { sourceType, sourceId });
}
