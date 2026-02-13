import { Router, Request, Response } from 'express';
import { getPool } from '../db/pool.js';

const router: ReturnType<typeof Router> = Router();

router.get('/', async (_req: Request, res: Response) => {
  const pool = getPool();

  const [usersResult, postsResult, claimsResult, relationsResult] =
    await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query('SELECT COUNT(*)::int AS count FROM posts'),
      pool.query('SELECT COUNT(*)::int AS count FROM canonical_claims'),
      pool.query('SELECT COUNT(*)::int AS count FROM adus'),
    ]);

  res.json({
    success: true,
    data: {
      users: usersResult.rows[0].count,
      posts: postsResult.rows[0].count,
      claims_analyzed: claimsResult.rows[0].count,
      arguments_mapped: relationsResult.rows[0].count,
    },
  });
});

export default router;
