import { Router, Request, Response } from 'express';
import { getPool } from '../db/pool.js';

const router: ReturnType<typeof Router> = Router();

router.get('/', async (_req: Request, res: Response) => {
  const pool = getPool();

  const [usersResult, postsResult, iNodesResult, conceptsResult] =
    await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query('SELECT COUNT(*)::int AS count FROM posts'),
      pool.query('SELECT COUNT(*)::int AS count FROM v3_nodes_i'),
      pool.query('SELECT COUNT(*)::int AS count FROM v3_concept_nodes'),
    ]);

  res.json({
    success: true,
    data: {
      users: usersResult.rows[0].count,
      posts: postsResult.rows[0].count,
      claims_analyzed: iNodesResult.rows[0].count,
      concepts_mapped: conceptsResult.rows[0].count,
    },
  });
});

export default router;
