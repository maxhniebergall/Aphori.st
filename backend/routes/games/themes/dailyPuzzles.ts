/**
 * Daily Puzzles API Routes
 * Handles puzzle retrieval and generation
 */

import { Router, Request, Response } from 'express';
import { getThemesServices } from './index.js';
import { getCurrentDateString } from '../../../config/database/games.js';
import { isValidDate } from '../../../types/games/themes.js';
import logger from '../../../logger.js';

const router = Router();

// Only one route needed - get today's puzzles

/**
 * GET /api/games/themes/daily
 * Get today's puzzles (convenience endpoint)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const today = getCurrentDateString();
    const { puzzleGenerator } = getThemesServices();
    const puzzles = await puzzleGenerator.getDailyPuzzles(today);

    res.json({
      success: true,
      data: {
        date: today,
        puzzles,
        count: puzzles.length
      }
    });
  } catch (error) {
    logger.error('Error getting today\'s puzzles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get today\'s puzzles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;