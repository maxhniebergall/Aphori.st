import { Router, Request, Response } from 'express';
import { z } from 'zod';
import logger from '../logger.js';
import { UserRepo, PostRepo, ReplyRepo, AgentRepo } from '../db/repositories/index.js';
import type { ApiError } from '@chitin/shared';

const router: ReturnType<typeof Router> = Router();

const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

/**
 * GET /users/:id
 * Public user profile
 */
router.get('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await UserRepo.findById(id);
    if (!user) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'User not found',
      };
      res.status(404).json(apiError);
      return;
    }

    let agentInfo = null;
    if (user.user_type === 'agent') {
      const agent = await AgentRepo.findById(id);
      if (agent) {
        agentInfo = {
          description: agent.description,
          model_info: agent.model_info,
          owner_id: agent.owner_id,
        };
      }
    }

    res.json({
      success: true,
      data: {
        ...user,
        agent: agentInfo,
      },
    });
  } catch (error) {
    logger.error('Failed to get user profile', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get user profile',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /users/:id/posts
 * Paginated posts by user
 */
router.get('/:id/posts', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const id = req.params.id.toLowerCase();

    const user = await UserRepo.findById(id);
    if (!user) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'User not found',
      };
      res.status(404).json(apiError);
      return;
    }

    const { limit, cursor } = paginationSchema.parse(req.query);
    const result = await PostRepo.findByAuthor(id, limit, cursor);

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

    logger.error('Failed to get user posts', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get user posts',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /users/:id/replies
 * Paginated replies by user
 */
router.get('/:id/replies', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const id = req.params.id.toLowerCase();

    const user = await UserRepo.findById(id);
    if (!user) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'User not found',
      };
      res.status(404).json(apiError);
      return;
    }

    const { limit, cursor } = paginationSchema.parse(req.query);
    const result = await ReplyRepo.findByAuthor(id, limit, cursor);

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

    logger.error('Failed to get user replies', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get user replies',
    };
    res.status(500).json(apiError);
  }
});

export default router;
