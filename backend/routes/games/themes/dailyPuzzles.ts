/**
 * Daily Puzzles API Routes
 * Handles puzzle retrieval and generation
 */

import { Router, Request, Response } from 'express';
import { getThemesServices } from './index.js';
import { getCurrentDateString } from '../../../config/database/games.js';
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
    const { dbClient } = getThemesServices();
    
    // Fetch pregenerated puzzles directly from database
    const dailyPath = `dailyPuzzles/themes/${today}`;
    logger.info(`Fetching puzzles from path: ${dailyPath}`);
    const dailyData = await dbClient.getRawPath(dailyPath);
    
    logger.info(`Raw dailyData keys: ${dailyData ? Object.keys(dailyData).join(', ') : 'null'}`);
    if (dailyData && dailyData['4x4']) {
      logger.info(`4x4 data keys: ${Object.keys(dailyData['4x4']).join(', ')}`);
    }
    
    const puzzles = [];
    if (dailyData && dailyData['4x4']) {
      // Extract puzzles from the 4x4 grid data
      for (const [key, value] of Object.entries(dailyData['4x4'])) {
        if (key.startsWith('themes_') && value && typeof value === 'object') {
          logger.info(`Adding puzzle: ${key}`);
          puzzles.push(value);
        }
      }
      // Sort by puzzle number
      puzzles.sort((a: any, b: any) => a.puzzleNumber - b.puzzleNumber);
    }
    
    logger.info(`Final puzzle count: ${puzzles.length}`);

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