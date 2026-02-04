import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { createArgumentRepo } from '../db/repositories/ArgumentRepo.js';
import { createPostRepo } from '../db/repositories/PostRepo.js';
import { createReplyRepo } from '../db/repositories/ReplyRepo.js';
import { getArgumentService } from '../services/argumentService.js';

const router = Router();

// GET /api/v1/search?q=...&type=semantic
router.get('/', async (req, res) => {
  try {
    const { q, type = 'semantic', limit = '20' } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ success: false, error: 'Query parameter required' });
    }

    const limitNum = Math.min(Math.max(1, parseInt(limit as string) || 20), 100);

    if (type === 'semantic') {
      const argumentService = getArgumentService();
      const pool = getPool();
      const argumentRepo = createArgumentRepo(pool);
      const postRepo = createPostRepo(pool);
      const replyRepo = createReplyRepo(pool);

      // Generate query embedding
      const embeddingResponse = await argumentService.embedContent([q]);
      const queryEmbedding = embeddingResponse.embeddings_768[0];

      if (!queryEmbedding) {
        return res.status(500).json({ success: false, error: 'Failed to generate embedding' });
      }

      // Search with pgvector
      const results = await argumentRepo.semanticSearch(queryEmbedding, limitNum);

      // Enrich with full content
      const enriched = await Promise.all(
        results.map(async r => {
          if (r.source_type === 'post') {
            return postRepo.findByIdWithAuthor(r.source_id);
          } else {
            return replyRepo.findByIdWithAuthor(r.source_id);
          }
        })
      );

      res.json({
        success: true,
        data: {
          query: q,
          results: enriched.filter(r => r !== null),
        },
      });
    } else {
      res.status(400).json({ success: false, error: 'Invalid search type' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

export default router;
