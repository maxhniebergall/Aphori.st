import { Router, Request, Response } from 'express';
import { z } from 'zod';
import logger from '../logger.js';
import { VoteRepo, PostRepo, ReplyRepo } from '../db/repositories/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { voteLimiter } from '../middleware/rateLimit.js';
import { ownerVoteAggregate } from '../middleware/agentAggregateLimit.js';
import type { ApiError } from '@chitin/shared';

const router: ReturnType<typeof Router> = Router();

// Validation schemas
const createVoteSchema = z.object({
  target_type: z.enum(['post', 'reply']),
  target_id: z.string().uuid('Invalid target ID format'),
  value: z.union([z.literal(1), z.literal(-1)]),
});

const deleteVoteSchema = z.object({
  target_type: z.enum(['post', 'reply']),
  target_id: z.string().uuid('Invalid target ID format'),
});

/**
 * POST /votes
 * Create or update a vote
 */
router.post('/', authenticateToken, ownerVoteAggregate, voteLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const input = createVoteSchema.parse(req.body);

    // Verify target exists
    if (input.target_type === 'post') {
      const post = await PostRepo.findById(input.target_id);
      if (!post) {
        const apiError: ApiError = {
          error: 'Not Found',
          message: 'Post not found',
        };
        res.status(404).json(apiError);
        return;
      }
    } else {
      const reply = await ReplyRepo.findById(input.target_id);
      if (!reply) {
        const apiError: ApiError = {
          error: 'Not Found',
          message: 'Reply not found',
        };
        res.status(404).json(apiError);
        return;
      }
    }

    const vote = await VoteRepo.upsert(req.user!.id, input);

    logger.info('Vote recorded', {
      voteId: vote.id,
      userId: req.user!.id,
      targetType: input.target_type,
      targetId: input.target_id,
      value: input.value,
    });

    res.status(201).json({
      success: true,
      data: vote,
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

    logger.error('Failed to create vote', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to create vote',
    };
    res.status(500).json(apiError);
  }
});

/**
 * DELETE /votes
 * Remove a vote
 */
router.delete('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const input = deleteVoteSchema.parse(req.body);

    const deleted = await VoteRepo.delete(req.user!.id, input.target_type, input.target_id);

    if (!deleted) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Vote not found',
      };
      res.status(404).json(apiError);
      return;
    }

    logger.info('Vote removed', {
      userId: req.user!.id,
      targetType: input.target_type,
      targetId: input.target_id,
    });

    res.json({
      success: true,
      message: 'Vote removed successfully',
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

    logger.error('Failed to delete vote', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to delete vote',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /votes/user
 * Get user's votes for specific targets
 */
router.get('/user', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const targetType = req.query.target_type as 'post' | 'reply' | undefined;
    const targetIds = req.query.target_ids as string | undefined;

    if (!targetType || !targetIds) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'target_type and target_ids query parameters are required',
      };
      res.status(400).json(apiError);
      return;
    }

    if (targetType !== 'post' && targetType !== 'reply') {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'target_type must be "post" or "reply"',
      };
      res.status(400).json(apiError);
      return;
    }

    const ids = targetIds.split(',').filter(id => id.trim());

    if (ids.length === 0 || ids.length > 100) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'target_ids must contain 1-100 comma-separated UUIDs',
      };
      res.status(400).json(apiError);
      return;
    }

    const votes = await VoteRepo.getVotesForTargets(req.user!.id, targetType, ids);

    // Convert Map to object for JSON serialization
    const votesObj: Record<string, number> = {};
    for (const [id, value] of votes) {
      votesObj[id] = value;
    }

    res.json({
      success: true,
      data: votesObj,
    });
  } catch (error) {
    logger.error('Failed to get user votes', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get user votes',
    };
    res.status(500).json(apiError);
  }
});

export default router;
