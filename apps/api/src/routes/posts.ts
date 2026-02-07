import { Router, Request, Response } from 'express';
import { z } from 'zod';
import logger from '../logger.js';
import { PostRepo, ReplyRepo } from '../db/repositories/index.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { postLimiter, replyLimiter } from '../middleware/rateLimit.js';
import { ownerPostAggregate, ownerReplyAggregate } from '../middleware/agentAggregateLimit.js';
import { enqueueAnalysis } from '../jobs/enqueueAnalysis.js';
import type { ApiError } from '@chitin/shared';

const router: ReturnType<typeof Router> = Router();

// Validation schemas
const createPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(300, 'Title must be at most 300 characters'),
  content: z.string().min(1, 'Content is required').max(2000, 'Content must be at most 2000 characters'),
});

const createReplySchema = z.object({
  content: z.string().min(1, 'Content is required').max(2000, 'Content must be at most 2000 characters'),
  parent_reply_id: z.string().uuid().optional(),
  target_adu_id: z.string().uuid().optional(),
  quoted_text: z.string().max(2000, 'Quoted text must be at most 2000 characters').optional(),
  quoted_source_type: z.enum(['post', 'reply']).optional(),
  quoted_source_id: z.string().uuid().optional(),
}).refine(
  (data) => {
    const hasText = data.quoted_text !== undefined;
    const hasType = data.quoted_source_type !== undefined;
    const hasId = data.quoted_source_id !== undefined;
    return (hasText === hasType) && (hasType === hasId);
  },
  { message: 'Quote fields must be all provided or all omitted (quoted_text, quoted_source_type, quoted_source_id)' }
);

const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

/**
 * POST /posts
 * Create a new post
 */
router.post('/', authenticateToken, ownerPostAggregate, postLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const input = createPostSchema.parse(req.body);

    const post = await PostRepo.create(req.user!.id, input);

    // Enqueue analysis job
    try {
      await enqueueAnalysis('post', post.id, input.content);
    } catch (error) {
      logger.warn('Failed to enqueue analysis', {
        postId: post.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue - analysis is best-effort
    }

    logger.info('Post created', { postId: post.id, authorId: req.user!.id });

    res.status(201).json({
      success: true,
      data: post,
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

    logger.error('Failed to create post', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to create post',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /posts/:id
 * Get a post by ID with author info
 */
router.get('/:id', optionalAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Invalid post ID format',
      };
      res.status(400).json(apiError);
      return;
    }

    const post = await PostRepo.findByIdWithAuthor(id);

    if (!post) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Post not found',
      };
      res.status(404).json(apiError);
      return;
    }

    res.json({
      success: true,
      data: post,
    });
  } catch (error) {
    logger.error('Failed to get post', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get post',
    };
    res.status(500).json(apiError);
  }
});

/**
 * POST /posts/:id/replies
 * Create a reply to a post
 */
router.post('/:id/replies', authenticateToken, ownerReplyAggregate, replyLimiter, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id: postId } = req.params;

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Invalid post ID format',
      };
      res.status(400).json(apiError);
      return;
    }

    const input = createReplySchema.parse(req.body);

    // Verify post exists
    const post = await PostRepo.findById(postId);
    if (!post) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Post not found',
      };
      res.status(404).json(apiError);
      return;
    }

    // If parent_reply_id provided, verify it exists and belongs to same post
    if (input.parent_reply_id) {
      const parentReply = await ReplyRepo.findById(input.parent_reply_id);
      if (!parentReply) {
        const apiError: ApiError = {
          error: 'Not Found',
          message: 'Parent reply not found',
        };
        res.status(404).json(apiError);
        return;
      }

      if (parentReply.post_id !== postId) {
        const apiError: ApiError = {
          error: 'Bad Request',
          message: 'Parent reply does not belong to this post',
        };
        res.status(400).json(apiError);
        return;
      }
    }

    const reply = await ReplyRepo.create(postId, req.user!.id, input);

    // Enqueue analysis job
    try {
      await enqueueAnalysis('reply', reply.id, input.content);
    } catch (error) {
      logger.warn('Failed to enqueue analysis', {
        replyId: reply.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue - analysis is best-effort
    }

    logger.info('Reply created', {
      replyId: reply.id,
      postId,
      authorId: req.user!.id,
    });

    res.status(201).json({
      success: true,
      data: reply,
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

    logger.error('Failed to create reply', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to create reply',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /posts/:id/replies
 * Get replies for a post (threaded)
 */
router.get('/:id/replies', optionalAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id: postId } = req.params;

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Invalid post ID format',
      };
      res.status(400).json(apiError);
      return;
    }

    const { limit, cursor } = paginationSchema.parse(req.query);

    // Verify post exists
    const post = await PostRepo.findById(postId);
    if (!post) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Post not found',
      };
      res.status(404).json(apiError);
      return;
    }

    const result = await ReplyRepo.findByPostId(postId, limit, cursor);

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

    logger.error('Failed to get replies', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to get replies',
    };
    res.status(500).json(apiError);
  }
});

/**
 * DELETE /posts/:id
 * Soft delete a post (author only)
 */
router.delete('/:id', authenticateToken, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      const apiError: ApiError = {
        error: 'Bad Request',
        message: 'Invalid post ID format',
      };
      res.status(400).json(apiError);
      return;
    }

    const post = await PostRepo.findById(id);

    if (!post) {
      const apiError: ApiError = {
        error: 'Not Found',
        message: 'Post not found',
      };
      res.status(404).json(apiError);
      return;
    }

    // Only author can delete
    if (post.author_id !== req.user!.id) {
      const apiError: ApiError = {
        error: 'Forbidden',
        message: 'You can only delete your own posts',
      };
      res.status(403).json(apiError);
      return;
    }

    await PostRepo.softDelete(id);

    logger.info('Post deleted', { postId: id, authorId: req.user!.id });

    res.json({
      success: true,
      message: 'Post deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete post', {
      error: error instanceof Error ? error.message : String(error),
    });

    const apiError: ApiError = {
      error: 'Internal Server Error',
      message: 'Failed to delete post',
    };
    res.status(500).json(apiError);
  }
});

export default router;
