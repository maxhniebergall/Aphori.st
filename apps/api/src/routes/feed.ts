import { Router } from 'express';

const router = Router();

// Placeholder - will be implemented in feed task
router.get('/', (_req, res) => {
  res.json({ message: 'Feed routes - to be implemented' });
});

export default router;
