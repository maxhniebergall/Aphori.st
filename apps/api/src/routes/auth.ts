import { Router } from 'express';

const router = Router();

// Placeholder - will be implemented in auth task
router.get('/', (_req, res) => {
  res.json({ message: 'Auth routes - to be implemented' });
});

export default router;
