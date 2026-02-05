import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import logger from '../logger.js';
import { UserRepo } from '../db/repositories/index.js';
import type { AuthenticatedUser, AuthTokenPayload, UserType } from '@chitin/shared';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Required authentication middleware
 * Blocks unauthenticated requests
 */
export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication token required',
    });
    return;
  }

  // Dev token for non-production environments
  if (config.env !== 'production' && token === 'dev_token') {
    req.user = {
      id: 'dev_user',
      email: 'dev@aphori.st',
      user_type: 'human',
    };
    // Ensure dev_user exists in DB (auto-create on first use)
    const existing = await UserRepo.findById('dev_user');
    if (!existing) {
      await UserRepo.create('dev_user', 'dev@aphori.st', 'human', 'Dev User');
    }
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as AuthTokenPayload;

    // Validate payload structure
    if (!decoded.id || !decoded.email) {
      throw new Error('Invalid token payload');
    }

    // Check if agent token is revoked
    if (decoded.jti) {
      const { AgentRepo } = await import('../db/repositories/index.js');
      const isValid = await AgentRepo.isTokenValid(decoded.jti);
      if (!isValid) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Token has been revoked',
        });
        return;
      }
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      user_type: decoded.user_type || 'human',
    };

    next();
  } catch (error) {
    logger.warn('Token verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Token has expired',
      });
      return;
    }

    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid authentication token',
    });
  }
}

/**
 * Optional authentication middleware
 * Attaches user if token present, but allows anonymous requests
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) {
    next();
    return;
  }

  // Dev token for non-production environments
  if (config.env !== 'production' && token === 'dev_token') {
    req.user = {
      id: 'dev_user',
      email: 'dev@aphori.st',
      user_type: 'human',
    };
    // Ensure dev_user exists in DB (auto-create on first use)
    const existing = await UserRepo.findById('dev_user');
    if (!existing) {
      await UserRepo.create('dev_user', 'dev@aphori.st', 'human', 'Dev User');
    }
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as AuthTokenPayload;

    if (decoded.id && decoded.email) {
      req.user = {
        id: decoded.id,
        email: decoded.email,
        user_type: decoded.user_type || 'human',
      };
    }
  } catch (error) {
    // Token invalid, but that's okay for optional auth
    logger.debug('Optional auth token invalid', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  next();
}

/**
 * Generate a magic link token (15 min expiry)
 */
export function generateMagicToken(email: string): string {
  return jwt.sign(
    { email },
    config.jwt.magicLinkSecret,
    { expiresIn: '15m' }
  );
}

/**
 * Verify a magic link token
 */
export function verifyMagicToken(token: string): { email: string } | null {
  try {
    const decoded = jwt.verify(token, config.jwt.magicLinkSecret) as { email: string };
    if (typeof decoded.email === 'string') {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate an auth token (7 day expiry by default, custom for agent tokens)
 */
export function generateAuthToken(
  id: string,
  email: string,
  userType: UserType = 'human',
  jti?: string,
  expiresIn?: string | number
): string {
  const payload: AuthTokenPayload = {
    id,
    email,
    user_type: userType,
    ...(jti && { jti }),
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: expiresIn ?? config.jwt.expiresIn,
  } as jwt.SignOptions);
}

/**
 * Verify an auth token
 */
export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as AuthTokenPayload;
    if (decoded.id && decoded.email) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}
