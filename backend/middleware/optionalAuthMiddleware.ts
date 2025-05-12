import { Request as ExpressRequest, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthTokenPayload } from '../types/index.js';
import logger from '../logger.js';

// Define an interface for requests that might have a user
interface OptionallyAuthenticatedRequest extends ExpressRequest {
  user?: AuthTokenPayload;
  // Add locals for requestId if not globally typed for Express.Request
  locals: {
    requestId?: string;
  };
}

export const optionalAuthMiddleware = (baseReq: ExpressRequest, res: Response, next: NextFunction) => {
  // Assert to custom type to access user and specific locals structure
  const req = baseReq as OptionallyAuthenticatedRequest;

  const authHeader = req.headers.authorization;
  // Ensure req.locals exists before trying to access requestId, or handle if it might be undefined
  const requestId = req.locals?.requestId; 

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    try {
      // Handle development token if your app uses one for easier testing
      if (process.env.NODE_ENV !== 'production' && token === 'dev_token') {
        req.user = { id: 'dev_user', email: 'dev@example.com' };
        logger.debug({ requestId, userId: 'dev_user' }, 'OptionalAuth: Dev token identified.');
      } else if (process.env.AUTH_TOKEN_SECRET) {
        const decoded = jwt.verify(token, process.env.AUTH_TOKEN_SECRET) as AuthTokenPayload;
        req.user = decoded;
        logger.debug({ requestId, userId: decoded.id }, 'OptionalAuth: User identified from token.');
      } else {
        // This case should ideally not happen in a configured environment
        logger.warn({ requestId }, 'OptionalAuth: AUTH_TOKEN_SECRET not set. Cannot verify token.');
      }
    } catch (error) {
      // Token is invalid (e.g., expired, malformed)
      // Log the issue but proceed as an anonymous user
      logger.warn({ requestId, tokenProvided: true, error }, 'OptionalAuth: Invalid token, proceeding as anonymous.');
    }
  } else {
    // No token provided, proceed as an anonymous user
    // logger.debug({ requestId, tokenProvided: false }, 'OptionalAuth: No token, proceeding as anonymous.'); // Optional: can be verbose
  }
  next();
}; 