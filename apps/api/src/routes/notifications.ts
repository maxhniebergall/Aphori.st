import { Router, Request, Response } from 'express';
import { z } from 'zod';
import logger from '../logger.js';
import { UserRepo, NotificationRepo } from '../db/repositories/index.js';
import { authenticateToken } from '../middleware/auth.js';
import type { ApiError } from '@chitin/shared';

const router: ReturnType<typeof Router> = Router();

const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

/**
 * GET /notifications
 * Get paginated notifications for the authenticated user
 */
router.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit, cursor } = paginationSchema.parse(req.query);

    const user = await UserRepo.findById(req.user!.id);
    if (!user) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'User not found',
      };
      res.status(404).json(apiError);
      return;
    }

    const result = await NotificationRepo.findByUserId(
      req.user!.id,
      limit,
      cursor,
      user.notifications_last_viewed_at
    );

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

    logger.error('Failed to get notifications', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get notifications',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /notifications/new-count
 * Get count of new notifications since last viewed
 */
router.get('/new-count', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await UserRepo.findById(req.user!.id);
    if (!user) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'User not found',
      };
      res.status(404).json(apiError);
      return;
    }

    const count = await NotificationRepo.countNew(
      req.user!.id,
      user.notifications_last_viewed_at
    );

    res.json({
      success: true,
      data: { count },
    });
  } catch (error) {
    logger.error('Failed to get new notification count', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get new notification count',
    };
    res.status(500).json(apiError);
  }
});

/**
 * POST /notifications/viewed
 * Mark notifications as viewed (updates last_viewed_at timestamp)
 */
router.post('/viewed', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await UserRepo.findById(req.user!.id);
    if (!user) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'User not found',
      };
      res.status(404).json(apiError);
      return;
    }

    await UserRepo.updateNotificationsLastViewedAt(req.user!.id);

    res.json({
      success: true,
      message: 'Notifications marked as viewed',
    });
  } catch (error) {
    logger.error('Failed to mark notifications as viewed', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to mark notifications as viewed',
    };
    res.status(500).json(apiError);
  }
});

export default router;
