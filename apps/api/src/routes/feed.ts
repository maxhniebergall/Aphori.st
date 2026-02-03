import { Router, Request, Response } from 'express';
import { z } from 'zod';
import logger from '../logger.js';
import { PostRepo } from '../db/repositories/index.js';
import { optionalAuth } from '../middleware/auth.js';
import type { ApiError, FeedSortType } from '@chitin/shared';

const router = Router();

// Validation schema
const feedSchema = z.object({
  sort: z.enum(['hot', 'new', 'top', 'rising', 'controversial']).default('hot'),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

/**
 * GET /feed
 * Get the main post feed with various sorting options
 */
router.get('/', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sort, limit, cursor } = feedSchema.parse(req.query);

    // Note: Rising and controversial are more complex and not fully implemented
    // For now, they fall back to hot
    const effectiveSort: FeedSortType = ['rising', 'controversial'].includes(sort) ? 'hot' : sort as FeedSortType;

    const result = await PostRepo.getFeed(effectiveSort, limit, cursor);

    res.json({
      success: true,
      data: result,
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

    logger.error('Failed to get feed', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get feed',
    };
    res.status(500).json(apiError);
  }
});

export default router;
