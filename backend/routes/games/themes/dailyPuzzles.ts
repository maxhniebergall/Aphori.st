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

/**
 * GET /api/games/themes/daily/:date
 * Get all puzzles for a specific date
 */
router.get('/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;

    // Validate date format
    if (!isValidDate(date)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD.'
      });
      return;
    }

    const { puzzleGenerator } = getThemesServices();
    const puzzles = await puzzleGenerator.generateDailyPuzzles(date);

    res.json({
      success: true,
      data: {
        date,
        puzzles,
        count: puzzles.length
      }
    });
  } catch (error) {
    logger.error('Error getting daily puzzles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get daily puzzles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/games/themes/daily/:date/:puzzleId
 * Get a specific puzzle
 */
router.get('/:date/:puzzleId', async (req: Request, res: Response) => {
  try {
    const { date, puzzleId } = req.params;

    // Validate date format
    if (!isValidDate(date)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD.'
      });
      return;
    }

    const { puzzleGenerator } = getThemesServices();
    const puzzle = await puzzleGenerator.getPuzzle(date, puzzleId);

    if (!puzzle) {
      res.status(404).json({
        success: false,
        error: 'Puzzle not found'
      });
      return;
    }

    res.json({
      success: true,
      data: puzzle
    });
  } catch (error) {
    logger.error('Error getting puzzle:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get puzzle',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

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