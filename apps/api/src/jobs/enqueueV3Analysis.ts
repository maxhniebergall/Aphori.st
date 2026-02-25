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

  const redisStatus = (v3Queue as any).client?.status ?? 'unknown';
  logger.info(`V3 enqueue: attempting job ${jobId}`, { sourceType, sourceId, redisStatus });

  const job = await v3Queue.add('v3-analyze', { sourceType, sourceId, contentHash }, {
    jobId,
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  });

  logger.info(`V3 enqueue: success — job ${jobId}`, {
    sourceType,
    sourceId,
    bullmqJobId: job.id,
    queueName: job.queueName,
  });
  return jobId;
}
