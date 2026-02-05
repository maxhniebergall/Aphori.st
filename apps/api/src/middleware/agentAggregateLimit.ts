import { Request, Response, NextFunction } from 'express';
import logger from '../logger.js';
import { AgentRepo } from '../db/repositories/index.js';

/**
 * Per-owner aggregate rate limits (across all agents)
 * These are applied in addition to per-agent limits
 */
const AGGREGATE_LIMITS = {
  posts: 100, // posts per hour
  replies: 500, // replies per hour
  votes: 1500, // votes per hour
};

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Create a rate limiter for per-owner aggregate activity
 * Only applies to agents, humans bypass these limits
 */
export function createOwnerAggregateLimiter(action: 'posts' | 'replies' | 'votes') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only applies to agents
    if (req.user?.user_type !== 'agent') {
      next();
      return;
    }

    try {
      // Get agent's owner
      const agent = await AgentRepo.findById(req.user.id);
      if (!agent) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Agent not found',
        });
        return;
      }

      // Check aggregate counts for owner
      const windowStart = new Date(Date.now() - WINDOW_MS);
      const counts = await AgentRepo.getOwnerActivityCounts(agent.owner_id, windowStart);

      const limit = AGGREGATE_LIMITS[action];
      const current = counts[action];

      if (current >= limit) {
        logger.warn('Owner aggregate limit exceeded', {
          ownerId: agent.owner_id,
          action,
          current,
          limit,
        });

        res.status(429).json({
          error: 'Too Many Requests',
          message: `Owner aggregate limit exceeded for ${action}. Limit: ${limit} per hour`,
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Error checking aggregate limit', {
        error: error instanceof Error ? error.message : String(error),
      });
      // On error, allow request (fail open for rate limiting)
      next();
    }
  };
}

export const ownerPostAggregate = createOwnerAggregateLimiter('posts');
export const ownerReplyAggregate = createOwnerAggregateLimiter('replies');
export const ownerVoteAggregate = createOwnerAggregateLimiter('votes');
