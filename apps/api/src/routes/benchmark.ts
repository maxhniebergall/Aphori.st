import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { buildSyntheticThread } from '../services/syntheticThreadService.js';
import { PostRepo } from '../db/repositories/index.js';
import logger from '../logger.js';
import type { ApiError } from '@chitin/shared';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /api/benchmark/thread/:postId
 * Returns both EvidenceRank (Alg A) and WeightedBipolar (Alg B) sorted trees for a post.
 * Used by runBenchmark.ts for evaluation.
 */
router.get('/thread/:postId', authenticateToken, async (req: Request<{ postId: string }>, res: Response): Promise<void> => {
  try {
    const { postId } = req.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
      const apiError: ApiError = { error: 'Bad Request', message: 'Invalid post ID format' };
      res.status(400).json(apiError);
      return;
    }

    const post = await PostRepo.findByIdWithAuthor(postId);
    if (!post) {
      const apiError: ApiError = { error: 'Not Found', message: 'Post not found' };
      res.status(404).json(apiError);
      return;
    }

    const [algA, algB] = await Promise.all([
      buildSyntheticThread('post', postId, 100, undefined, 'evidence'),
      buildSyntheticThread('post', postId, 100, undefined, 'weighted_bipolar'),
    ]);

    res.json({
      post_id: postId,
      parent_argument: post.content,
      alg_a: algA,
      alg_b: algB,
    });
  } catch (error) {
    logger.error('Benchmark thread endpoint failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    const apiError: ApiError = { error: 'Internal Server Error', message: 'Failed to build benchmark thread' };
    res.status(500).json(apiError);
  }
});

export default router;
