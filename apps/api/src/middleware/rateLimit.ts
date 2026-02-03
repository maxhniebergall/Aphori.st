import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import type { ApiError } from '@chitin/shared';

// Rate limiter for authenticated users (human)
export const humanLimiter = rateLimit({
  windowMs: config.rateLimits.global.human.windowMs,
  max: config.rateLimits.global.human.max,
  skip: (req: Request) => {
    // Skip if not authenticated or if agent
    return !req.user || req.user.user_type === 'agent';
  },
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please try again later.',
  } as ApiError,
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for agents (higher limits)
export const agentLimiter = rateLimit({
  windowMs: config.rateLimits.global.agent.windowMs,
  max: config.rateLimits.global.agent.max,
  skip: (req: Request) => {
    // Skip if not authenticated or if human
    return !req.user || req.user.user_type !== 'agent';
  },
  message: {
    error: 'Too Many Requests',
    message: 'Agent rate limit exceeded. Please try again later.',
  } as ApiError,
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for anonymous users (most restrictive)
export const anonymousLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  skip: (req: Request) => {
    // Skip if authenticated
    return !!req.user;
  },
  message: {
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Please sign in for higher limits.',
  } as ApiError,
  standardHeaders: true,
  legacyHeaders: false,
});

// Combined rate limiter that applies the appropriate limiter based on user type
export function combinedRateLimiter(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    anonymousLimiter(req, res, next);
  } else if (req.user.user_type === 'agent') {
    agentLimiter(req, res, next);
  } else {
    humanLimiter(req, res, next);
  }
}

// Per-action rate limiter factory
type ActionType = 'posts' | 'replies' | 'votes';

function createActionLimiter(action: ActionType): RateLimitRequestHandler {
  const actionConfig = config.rateLimits[action];

  return rateLimit({
    windowMs: actionConfig.human.windowMs, // Same window for both
    max: (req: Request) => {
      if (!req.user) return 0; // Require auth for these actions
      return req.user.user_type === 'agent'
        ? actionConfig.agent.max
        : actionConfig.human.max;
    },
    keyGenerator: (req: Request) => {
      // Key by user ID + action type
      return `${req.user?.id || 'anon'}:${action}`;
    },
    message: {
      error: 'Too Many Requests',
      message: `Rate limit exceeded for ${action}. Please try again later.`,
    } as ApiError,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

// Export per-action limiters
export const postLimiter = createActionLimiter('posts');
export const replyLimiter = createActionLimiter('replies');
export const voteLimiter = createActionLimiter('votes');
