import { Router, type Router as RouterType } from 'express';
import { getPool } from '../db/pool.js';
import { createArgumentRepo, type SearchResult } from '../db/repositories/ArgumentRepo.js';
import { createV3HypergraphRepo } from '../db/repositories/V3HypergraphRepo.js';
import { PostRepo } from '../db/repositories/PostRepo.js';
import { ReplyRepo } from '../db/repositories/ReplyRepo.js';
import { getArgumentService } from '../services/argumentService.js';
import { searchLimiter } from '../middleware/rateLimit.js';
import type { PostWithAuthor, ReplyWithAuthor } from '@chitin/shared';

const router: RouterType = Router();

// Apply per-action rate limit to all search routes
router.use(searchLimiter);

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

      // Generate query embedding — realtime, blocking the request-response cycle
      const realtimeQueryEmbedding = await argumentService.embedSearchQuery(q);

      // Search with pgvector
      const v3Repo = createV3HypergraphRepo(pool);

      // Run content search and I-node match in parallel
      const [results, similarINodes] = await Promise.all([
        argumentRepo.semanticSearch(realtimeQueryEmbedding, limitNum),
        v3Repo.findSimilarINodes(realtimeQueryEmbedding, 0.85, 1),
      ]);

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

      // Enrich top I-node match with source info if found
      // Guard against null/NaN similarity (can occur with degenerate stored embeddings)
      let matchedINode = null;
      const topINode = similarINodes[0];
      const topSimilarity = topINode ? Number(topINode.similarity) : NaN;
      if (topINode && !isNaN(topSimilarity) && topSimilarity >= 0.85) {
        if (topINode.source_type === 'post') {
          const row = await pool.query(
            `SELECT p.id, p.title, u.display_name, u.id as user_id
             FROM posts p JOIN users u ON p.author_id = u.id
             WHERE p.id = $1 AND p.deleted_at IS NULL`,
            [topINode.source_id]
          );
          if (row.rows[0]) {
            matchedINode = {
              i_node_id: topINode.id,
              content: topINode.content,
              rewritten_text: topINode.rewritten_text,
              epistemic_type: topINode.epistemic_type,
              similarity: topINode.similarity,
              source_type: topINode.source_type,
              source_id: topINode.source_id,
              source_post_id: topINode.source_id,
              source_title: row.rows[0].title,
              source_author: row.rows[0].display_name || row.rows[0].user_id,
            };
          }
        } else {
          const row = await pool.query(
            `SELECT r.id, r.post_id, p.title, u.display_name, u.id as user_id
             FROM replies r JOIN posts p ON r.post_id = p.id JOIN users u ON r.author_id = u.id
             WHERE r.id = $1 AND r.deleted_at IS NULL`,
            [topINode.source_id]
          );
          if (row.rows[0]) {
            matchedINode = {
              i_node_id: topINode.id,
              content: topINode.content,
              rewritten_text: topINode.rewritten_text,
              epistemic_type: topINode.epistemic_type,
              similarity: topINode.similarity,
              source_type: topINode.source_type,
              source_id: topINode.source_id,
              source_post_id: row.rows[0].post_id,
              source_title: row.rows[0].title,
              source_author: row.rows[0].display_name || row.rows[0].user_id,
            };
          }
        }
      }

      res.json({
        success: true,
        data: {
          query: q,
          matched_inode: matchedINode,
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
