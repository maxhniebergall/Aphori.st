/**
 * Games API Router
 * Main router for all game-related endpoints
 * 
 * Note: When running TypeScript scripts in dev container, use:
 * docker exec aphorist-backend-1 sh -c 'cd /app && NODE_OPTIONS="--loader ts-node/esm --experimental-specifier-resolution=node" node script.ts'
 */

import { Router } from 'express';
import themesRoutes from './themes/index.js';

const router = Router();

// Mount themes game routes
router.use('/themes', themesRoutes);

// Future games can be mounted here
// router.use('/wordle', wordleRoutes);
// router.use('/crossword', crosswordRoutes);

// Games landing page info
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      message: 'Aphorist Games API',
      availableGames: [
        {
          name: 'Themes',
          path: '/themes',
          description: 'Connections-style word categorization puzzles'
        }
      ],
      version: '1.0.0'
    }
  });
});

export default router;