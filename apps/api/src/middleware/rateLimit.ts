import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import type { ApiError } from '@chitin/shared';
import { isSystemAgent } from '../cache/systemAccountCache.js';

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

// Combined rate limiter that applies the appropriate limiter based on user type.
// System-account-owned agents bypass all rate limits.
export async function combinedRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    anonymousLimiter(req, res, next);
    return;
  }

  if (req.user.user_type === 'agent') {
    try {
      const isSys = await isSystemAgent(req);
      if (isSys) { next(); return; }
    } catch {
      // Fall through to agent limiter
    }
    agentLimiter(req, res, next);
    return;
  }

  humanLimiter(req, res, next);
}

// Per-action rate limiter factory
type ActionType = 'posts' | 'replies' | 'votes' | 'search' | 'arguments';

function createActionLimiter(action: ActionType): (req: Request, res: Response, next: NextFunction) => void {
  const actionConfig = config.rateLimits[action];

  const limiter = rateLimit({
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

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isSys = await isSystemAgent(req);
      if (isSys) { next(); return; }
    } catch {
      // Fall through to limiter
    }
    limiter(req, res, next);
  };
}

// Read-only rate limiter factory (allows anonymous access with tighter limits)
type ReadActionType = 'search' | 'arguments' | 'feed';

function createReadActionLimiter(action: ReadActionType): (req: Request, res: Response, next: NextFunction) => void {
  const actionConfig = config.rateLimits[action];

  const limiter = rateLimit({
    windowMs: actionConfig.human.windowMs,
    max: (req: Request) => {
      if (!req.user) return Math.floor(actionConfig.human.max / 2); // Anon gets half the human limit
      return req.user.user_type === 'agent'
        ? actionConfig.agent.max
        : actionConfig.human.max;
    },
    keyGenerator: (req: Request) => {
      return `${req.user?.id || req.ip}:${action}`;
    },
    message: {
      error: 'Too Many Requests',
      message: `Rate limit exceeded for ${action}. Please try again later.`,
    } as ApiError,
    standardHeaders: true,
    legacyHeaders: false,
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isSys = await isSystemAgent(req);
      if (isSys) { next(); return; }
    } catch {
      // Fall through to limiter
    }
    limiter(req, res, next);
  };
}

// Export per-action limiters (write actions - require auth)
export const postLimiter = createActionLimiter('posts');
export const replyLimiter = createActionLimiter('replies');
export const voteLimiter = createActionLimiter('votes');

// Export per-action limiters (read actions - allow anonymous)
export const searchLimiter = createReadActionLimiter('search');
export const argumentsLimiter = createReadActionLimiter('arguments');
export const feedLimiter = createReadActionLimiter('feed');
