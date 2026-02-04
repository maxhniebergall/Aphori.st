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

  await argumentQueue.add('analyze', { sourceType, sourceId, contentHash }, {
    jobId,
  });

  logger.info(`Enqueued analysis job: ${jobId}`, { sourceType, sourceId });
}
