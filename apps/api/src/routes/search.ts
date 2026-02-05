import { Router, type Router as RouterType } from 'express';
import { getPool } from '../db/pool.js';
import { createArgumentRepo, type SearchResult } from '../db/repositories/ArgumentRepo.js';
import { PostRepo } from '../db/repositories/PostRepo.js';
import { ReplyRepo } from '../db/repositories/ReplyRepo.js';
import { getArgumentService } from '../services/argumentService.js';
import type { PostWithAuthor, ReplyWithAuthor } from '@chitin/shared';

const router: RouterType = Router();

// GET /api/v1/search?q=...&type=semantic
router.get('/', async (req, res) => {
  try {
    const { q, type = 'semantic', limit = '20' } = req.query;

    if (!q || typeof q !== 'string') {
      res.status(400).json({ success: false, error: 'Query parameter required' });
      return;
    }

    const limitNum = Math.min(Math.max(1, parseInt(limit as string) || 20), 100);

    if (type === 'semantic') {
      const argumentService = getArgumentService();
      const pool = getPool();
      const argumentRepo = createArgumentRepo(pool);

      // Generate query embedding
      const embeddingResponse = await argumentService.embedContent([q]);
      const queryEmbedding = embeddingResponse.embeddings_1536[0];

      if (!queryEmbedding) {
        res.status(500).json({ success: false, error: 'Failed to generate embedding' });
        return;
      }

      // Search with pgvector
      const results = await argumentRepo.semanticSearch(queryEmbedding, limitNum);

      // Enrich with full content, batching queries to limit concurrent DB operations
      const batchSize = 10;
      const enriched: Array<PostWithAuthor | ReplyWithAuthor | null> = [];

      for (let i = 0; i < results.length; i += batchSize) {
        const batch = results.slice(i, i + batchSize);
        const batchEnriched = await Promise.all(
          batch.map(async (r: SearchResult) => {
            if (r.source_type === 'post') {
              return PostRepo.findByIdWithAuthor(r.source_id);
            } else {
              return ReplyRepo.findByIdWithAuthor(r.source_id);
            }
          })
        );
        enriched.push(...batchEnriched);
      }

      res.json({
        success: true,
        data: {
          query: q,
          results: enriched.filter((r: PostWithAuthor | ReplyWithAuthor | null) => r !== null),
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
