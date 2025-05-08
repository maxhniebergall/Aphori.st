import rateLimit, { Options } from 'express-rate-limit';
import { Request as ExpressRequest, Response, NextFunction } from 'express';
import { AuthTokenPayload } from '../types/index.js';
import logger from '../logger.js';

// Define an interface for requests that might have a user (consistent with optionalAuthMiddleware)
interface OptionallyAuthenticatedRequest extends ExpressRequest {
  user?: AuthTokenPayload;
  locals: {
    requestId?: string;
  };
}

const defaultHandler = (baseReq: ExpressRequest, res: Response, next: NextFunction, options: Options) => {
  const req = baseReq as OptionallyAuthenticatedRequest; // Assert type to access custom properties
  logger.warn(
    { 
      requestId: req.locals.requestId,
      userId: req.user?.id,
      userIp: req.ip, // req.ip is standard on ExpressRequest
      limit: options.limit,
      windowMs: options.windowMs,
      path: req.path // req.path is standard on ExpressRequest
    },
    `Rate limit exceeded for path: ${req.path}`
  );
  res.status(options.statusCode).json({
    success: false,
    error: options.message,
  });
};

// Rate Limiter for Logged-In (Authenticated) Users
export const loggedInLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 300, // Max 300 requests per 10 minutes for each authenticated user
  keyGenerator: (baseReq: ExpressRequest, res: Response) => {
    const req = baseReq as OptionallyAuthenticatedRequest; // Assert type
    // req.user should be populated by optionalAuthMiddleware
    // The 'skip' function ensures req.user and req.user.id are defined here.
    return req.user!.id;
  },
  handler: defaultHandler,
  message: 'Too many requests from your account. Please try again after 15 minutes.',
  standardHeaders: 'draft-7', // Send standard `RateLimit` header
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (baseReq: ExpressRequest, res: Response) => {
    const req = baseReq as OptionallyAuthenticatedRequest; // Assert type
    return !req.user; // Skip if the user IS NOT authenticated (i.e., req.user is undefined)
  },
  // store: new RedisStore({ ... }), // TODO: For production, use a persistent store like Redis
});

// --- Layered Rate Limiters for Anonymous (Unauthenticated) Users ---

// Base options for anonymous limiters to avoid repetition
const anonymousLimiterBaseOptions = {
  keyGenerator: (req: ExpressRequest, res: Response) => {
    return req.ip || 'unknown-ip'; // Key by IP
  },
  handler: defaultHandler, // Reuse the same handler
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (baseReq: ExpressRequest, res: Response) => {
    const req = baseReq as OptionallyAuthenticatedRequest; // Assert type
    return !!req.user; // Skip if the user IS authenticated
  },
  // store: new RedisStore({ ... }), // TODO: For production, use a persistent store like Redis
};

// Layer 1 for Anonymous: 10 requests per minute
export const anonymousLimiterMinute = rateLimit({
  ...anonymousLimiterBaseOptions,
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 30,
  message: 'Too many requests from this IP address (minute limit). Please try again shortly.',
});

// Layer 2 for Anonymous: 100 requests per hour
export const anonymousLimiterHour = rateLimit({
  ...anonymousLimiterBaseOptions,
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 100,
  message: 'Too many requests from this IP address (hourly limit). Please try again later.',
});

// Layer 3 for Anonymous: 200 requests per day
export const anonymousLimiterDay = rateLimit({
  ...anonymousLimiterBaseOptions,
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: 200,
  message: 'Too many requests from this IP address (daily limit). Please try again tomorrow.',
});