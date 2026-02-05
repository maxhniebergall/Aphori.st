import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import logger from '../logger.js';
import { config } from '../config.js';
import { UserRepo } from '../db/repositories/index.js';
import { sendEmail } from '../services/mailer.js';
import {
  generateMagicToken,
  verifyMagicToken,
  generateAuthToken,
  verifyAuthToken,
  authenticateToken,
} from '../middleware/auth.js';
import type { ApiError } from '@chitin/shared';

const router: ReturnType<typeof Router> = Router();

// Rate limiter for magic link requests
const magicLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too Many Requests', message: 'Too many magic link requests, please try again later' },
});

// Validation schemas
const sendMagicLinkSchema = z.object({
  email: z.string().email('Invalid email format'),
  isSignup: z.boolean().optional(),
});

const verifyMagicLinkSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

const verifyTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

const signupSchema = z.object({
  id: z.string().min(3, 'ID must be at least 3 characters').max(64, 'ID must be at most 64 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'ID can only contain letters, numbers, underscores, and hyphens'),
  email: z.string().email('Invalid email format'),
  verificationToken: z.string().optional(),
  displayName: z.string().max(100).optional(),
});

const checkUserIdSchema = z.object({
  id: z.string().min(3, 'ID must be at least 3 characters'),
});

/**
 * POST /auth/send-magic-link
 * Send a magic link to the user's email
 */
router.post('/send-magic-link', magicLinkLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, isSignup } = sendMagicLinkSchema.parse(req.body);
    const lowerEmail = email.toLowerCase();

    // Check if user exists
    const existingUser = await UserRepo.findByEmail(lowerEmail);
    const isNewUser = !existingUser;
    const shouldSignup = isSignup === true || isNewUser;

    logger.info('Magic link request', { email: lowerEmail, isSignup: shouldSignup });

    // Generate token
    const token = generateMagicToken(lowerEmail);

    // Build magic link
    const baseUrl = shouldSignup
      ? `${config.appUrl}/auth/signup`
      : `${config.appUrl}/auth/verify`;
    const magicLink = `${baseUrl}?token=${token}&email=${encodeURIComponent(lowerEmail)}`;

    // Build email content
    const subject = shouldSignup ? 'Complete Your Sign Up' : 'Your Magic Link to Sign In';
    const actionText = shouldSignup ? 'complete your sign up' : 'sign in';
    const html = `
      <p>Hi,</p>
      <p>Click <a href="${magicLink}">here</a> to ${actionText}. This link will expire in 15 minutes.</p>
      <p>If you did not request this email, you can safely ignore it.</p>
      <p>Thanks,<br/>Chitin Social Team</p>
    `;

    await sendEmail(lowerEmail, subject, html);
    logger.info('Magic link sent', { email: lowerEmail });

    res.json({
      success: true,
      message: 'Magic link sent to your email',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const apiError: ApiError = {
        error: 'Validation Error',
        message: error.errors[0]?.message || 'Invalid input',
      };
      res.status(400).json(apiError);
      return;
    }

    logger.error('Failed to send magic link', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to send magic link',
    };
    res.status(500).json(apiError);
  }
});

/**
 * POST /auth/verify-magic-link
 * Verify magic link token and return auth token
 */
router.post('/verify-magic-link', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = verifyMagicLinkSchema.parse(req.body);

    // Verify the magic token
    const decoded = verifyMagicToken(token);
    if (!decoded) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Invalid or expired token',
      };
      res.status(400).json(apiError);
      return;
    }

    // Find the user
    const user = await UserRepo.findByEmail(decoded.email);
    if (!user) {
      const apiError: ApiError = {
        error: 'Unauthorized',
        message: 'User not found',
        details: { email: decoded.email },
      };
      res.status(401).json(apiError);
      return;
    }

    // Generate auth token
    const authToken = generateAuthToken(user.id, user.email, user.user_type);

    logger.info('Magic link verified', { userId: user.id });

    res.json({
      success: true,
      data: {
        token: authToken,
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          user_type: user.user_type,
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const apiError: ApiError = {
        error: 'Validation Error',
        message: error.errors[0]?.message || 'Invalid input',
      };
      res.status(400).json(apiError);
      return;
    }

    logger.error('Magic link verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Bad Request',
      message: 'Invalid or expired token',
    };
    res.status(400).json(apiError);
  }
});

/**
 * POST /auth/verify-token
 * Verify an existing auth token
 */
router.post('/verify-token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = verifyTokenSchema.parse(req.body);

    // Handle dev token in non-production
    if (config.env !== 'production' && token === 'dev_token') {
      res.json({
        success: true,
        data: {
          id: 'dev_user',
          email: 'dev@aphori.st',
          user_type: 'human',
        },
      });
      return;
    }

    // Verify the auth token
    const decoded = verifyAuthToken(token);
    if (!decoded) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Invalid token',
      };
      res.status(400).json(apiError);
      return;
    }

    // Check if agent token is revoked
    if (decoded.jti) {
      const { AgentRepo } = await import('../db/repositories/index.js');
      const isValid = await AgentRepo.isTokenValid(decoded.jti);
      if (!isValid) {
        const apiError: ApiError = {
          error: 'Bad Request',
          message: 'Token has been revoked',
        };
        res.status(400).json(apiError);
        return;
      }
    }

    // Verify user still exists
    const user = await UserRepo.findById(decoded.id);
    if (!user) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Invalid token',
      };
      res.status(400).json(apiError);
      return;
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        user_type: user.user_type,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const apiError: ApiError = {
        error: 'Validation Error',
        message: error.errors[0]?.message || 'Invalid input',
      };
      res.status(400).json(apiError);
      return;
    }

    logger.error('Token verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Bad Request',
      message: 'Invalid or expired token',
    };
    res.status(400).json(apiError);
  }
});

/**
 * GET /auth/check-user-id/:id
 * Check if a user ID is available
 */
router.get('/check-user-id/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = checkUserIdSchema.parse(req.params);

    const available = await UserRepo.isIdAvailable(id);

    res.json({
      success: true,
      data: {
        available,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const apiError: ApiError = {
        error: 'Validation Error',
        message: error.errors[0]?.message || 'Invalid input',
      };
      res.status(400).json(apiError);
      return;
    }

    logger.error('User ID check failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to check ID availability',
    };
    res.status(500).json(apiError);
  }
});

/**
 * POST /auth/signup
 * Create a new user account
 */
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, email, verificationToken, displayName } = signupSchema.parse(req.body);
    const lowerEmail = email.toLowerCase();

    logger.info('Signup request', { userId: id, email: lowerEmail });

    // Verify the magic link token if provided
    if (verificationToken) {
      const decoded = verifyMagicToken(verificationToken);
      if (!decoded) {
        const apiError: ApiError = {
          error: 'Bad Request',
          message: 'Invalid or expired verification token',
        };
        res.status(400).json(apiError);
        return;
      }

      if (decoded.email.toLowerCase() !== lowerEmail) {
        const apiError: ApiError = {
          error: 'Bad Request',
          message: 'Email does not match verification token',
        };
        res.status(400).json(apiError);
        return;
      }
    } else if (config.env === 'production') {
      // Require verification token in production
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Verification token required',
      };
      res.status(400).json(apiError);
      return;
    }

    // Create the user
    const result = await UserRepo.create(id, lowerEmail, 'human', displayName);

    if (!result.success || !result.data) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: result.error || 'Failed to create user',
      };
      res.status(400).json(apiError);
      return;
    }

    // Generate auth token if verification was successful
    let authToken = null;
    if (verificationToken || config.env !== 'production') {
      authToken = generateAuthToken(result.data.id, result.data.email, result.data.user_type);
    }

    logger.info('User created', { userId: id });

    res.json({
      success: true,
      message: 'User created successfully',
      data: authToken
        ? {
            token: authToken,
            user: {
              id: result.data.id,
              email: result.data.email,
              display_name: result.data.display_name,
              user_type: result.data.user_type,
            },
          }
        : undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const apiError: ApiError = {
        error: 'Validation Error',
        message: error.errors[0]?.message || 'Invalid input',
      };
      res.status(400).json(apiError);
      return;
    }

    logger.error('Signup failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to create user',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /auth/me
 * Get current authenticated user
 */
router.get('/me', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  // Handle dev token in non-production
  if (config.env !== 'production' && req.user!.id === 'dev_user') {
    res.json({
      success: true,
      data: {
        id: 'dev_user',
        email: 'dev@aphori.st',
        display_name: 'Dev User',
        user_type: 'human',
        created_at: new Date().toISOString(),
      },
    });
    return;
  }

  const user = await UserRepo.findById(req.user!.id);

  if (!user) {
    const apiError: ApiError = {
      error: 'Not Found',
      message: 'User not found',
    };
    res.status(404).json(apiError);
    return;
  }

  res.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      user_type: user.user_type,
      created_at: user.created_at,
    },
  });
});

export default router;
