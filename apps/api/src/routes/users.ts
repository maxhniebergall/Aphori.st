import { Router, Request, Response } from 'express';
import { z } from 'zod';
import logger from '../logger.js';
import { UserRepo, PostRepo, ReplyRepo, AgentRepo, FollowRepo } from '../db/repositories/index.js';
import { authenticateToken } from '../middleware/auth.js';
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

    // Exclude private fields from public profile
    const { notifications_last_viewed_at, email, ...publicUser } = user;

    res.json({
      success: true,
      data: {
        ...publicUser,
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

/**
 * POST /users/:id/follow
 * Follow a user (idempotent)
 */
router.post('/:id/follow', authenticateToken, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const targetId = req.params.id.toLowerCase();
    const currentUserId = req.user!.id.toLowerCase();

    if (currentUserId === targetId) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Cannot follow yourself',
      };
      res.status(400).json(apiError);
      return;
    }

    const target = await UserRepo.findById(targetId);
    if (!target) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'User not found',
      };
      res.status(404).json(apiError);
      return;
    }

    await FollowRepo.follow(currentUserId, targetId);

    res.json({ success: true, message: 'Followed successfully' });
  } catch (error) {
    logger.error('Failed to follow user', {
      error: error instanceof Error ? error.message : String(error),
    });
    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to follow user',
    };
    res.status(500).json(apiError);
  }
});

/**
 * DELETE /users/:id/follow
 * Unfollow a user
 */
router.delete('/:id/follow', authenticateToken, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const targetId = req.params.id.toLowerCase();

    await FollowRepo.unfollow(req.user!.id, targetId);

    res.json({ success: true, message: 'Unfollowed successfully' });
  } catch (error) {
    logger.error('Failed to unfollow user', {
      error: error instanceof Error ? error.message : String(error),
    });
    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to unfollow user',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /users/:id/followers
 * Paginated follower list (public)
 */
router.get('/:id/followers', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const id = req.params.id.toLowerCase();
    const { limit, cursor } = paginationSchema.parse(req.query);

    const result = await FollowRepo.getFollowers(id, limit, cursor);

    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const apiError: ApiError = {
        error: 'Validation Error',
        message: error.errors[0]?.message || 'Invalid input',
      };
      res.status(400).json(apiError);
      return;
    }

    logger.error('Failed to get followers', {
      error: error instanceof Error ? error.message : String(error),
    });
    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get followers',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /users/:id/following
 * Paginated following list (public)
 */
router.get('/:id/following', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const id = req.params.id.toLowerCase();
    const { limit, cursor } = paginationSchema.parse(req.query);

    const result = await FollowRepo.getFollowing(id, limit, cursor);

    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const apiError: ApiError = {
        error: 'Validation Error',
        message: error.errors[0]?.message || 'Invalid input',
      };
      res.status(400).json(apiError);
      return;
    }

    logger.error('Failed to get following', {
      error: error instanceof Error ? error.message : String(error),
    });
    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get following',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /users/:id/is-following
 * Check if authenticated user follows target user
 */
router.get('/:id/is-following', authenticateToken, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const targetId = req.params.id.toLowerCase();

    const following = await FollowRepo.isFollowing(req.user!.id, targetId);

    res.json({ success: true, data: { following } });
  } catch (error) {
    logger.error('Failed to check follow status', {
      error: error instanceof Error ? error.message : String(error),
    });
    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to check follow status',
    };
    res.status(500).json(apiError);
  }
});

export default router;
