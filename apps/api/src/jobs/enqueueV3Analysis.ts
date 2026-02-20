import crypto from 'crypto';
import { v3Queue } from './v3Queue.js';
import { logger } from '../utils/logger.js';

export async function enqueueV3Analysis(
  sourceType: 'post' | 'reply',
  sourceId: string,
  content: string
): Promise<string> {
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const jobId = `v3-${sourceType}-${sourceId}-${contentHash.substring(0, 8)}`;

  await v3Queue.add('v3-analyze', { sourceType, sourceId, contentHash }, {
    jobId,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  });

  logger.info(`Enqueued V3 analysis job: ${jobId}`, { sourceType, sourceId });
  return jobId;
}
