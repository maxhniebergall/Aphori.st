import { Router, Request, Response } from 'express';
import { z } from 'zod';
import logger from '../logger.js';
import { ReplyRepo } from '../db/repositories/index.js';
import { buildSyntheticThread } from '../services/syntheticThreadService.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import type { ApiError } from '@chitin/shared';

const router: ReturnType<typeof Router> = Router();

const replyQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
  sort: z.enum(['top', 'new', 'controversial', 'evidence']).default('new'),
});

/**
 * GET /replies/:id/replies
 * Get nested replies for a reply
 */
router.get('/:id/replies', optionalAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id: replyId } = req.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(replyId)) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Invalid reply ID format',
      };
      res.status(400).json(apiError);
      return;
    }

    const { limit, cursor, sort } = replyQuerySchema.parse(req.query);

    const reply = await ReplyRepo.findById(replyId);
    if (!reply) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Reply not found',
      };
      res.status(404).json(apiError);
      return;
    }

    if (sort === 'evidence') {
      const result = await buildSyntheticThread('reply', replyId, limit, cursor);
      res.json({ success: true, data: result });
      return;
    }

    const result = await ReplyRepo.findByParentReplyId(replyId, limit, cursor, sort);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: error.errors[0]?.message ?? 'Invalid query parameters',
      };
      res.status(400).json(apiError);
      return;
    }

    logger.error('Failed to get reply replies', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get reply replies',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /replies/:id
 * Get a reply by ID with author info
 */
router.get('/:id', optionalAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Invalid reply ID format',
      };
      res.status(400).json(apiError);
      return;
    }

    const reply = await ReplyRepo.findByIdWithAuthor(id);

    if (!reply) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Reply not found',
      };
      res.status(404).json(apiError);
      return;
    }

    res.json({
      success: true,
      data: reply,
    });
  } catch (error) {
    logger.error('Failed to get reply', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get reply',
    };
    res.status(500).json(apiError);
  }
});

/**
 * DELETE /replies/:id
 * Soft delete a reply (author only)
 */
router.delete('/:id', authenticateToken, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Invalid reply ID format',
      };
      res.status(400).json(apiError);
      return;
    }

    const reply = await ReplyRepo.findById(id);

    if (!reply) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Reply not found',
      };
      res.status(404).json(apiError);
      return;
    }

    // Only author can delete
    if (reply.author_id !== req.user!.id) {
      const apiError: ApiError = {
        error: 'Forbidden',
        message: 'You can only delete your own replies',
      };
      res.status(403).json(apiError);
      return;
    }

    await ReplyRepo.softDelete(id);

    logger.info('Reply deleted', { replyId: id, authorId: req.user!.id });

    res.json({
      success: true,
      message: 'Reply deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete reply', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to delete reply',
    };
    res.status(500).json(apiError);
  }
});

export default router;
