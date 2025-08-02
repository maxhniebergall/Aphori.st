/**
 * Admin API Routes for Themes Game
 * Handles puzzle generation, validation, and management
 */

import { Router, Request, Response } from 'express';
import { getThemesServices } from './index.js';
import { getCurrentDateString } from '../../../config/database/games.js';
import { isValidDate } from '../../../types/games/themes.js';
import logger from '../../../logger.js';

const router = Router();

// TODO: Add proper admin authentication middleware
// For now, these routes are unprotected for development

/**
 * POST /api/games/themes/admin/generate-daily/:date
 * Generate all daily puzzles for a specific date
 */
router.post('/generate-daily/:date', async (req: Request, res: Response) => {
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
    
    logger.info(`Starting puzzle generation for date: ${date}`);
    const puzzles = await puzzleGenerator.generateDailyPuzzles(date);

    res.json({
      success: true,
      data: {
        date,
        generated: puzzles.length,
        puzzles: puzzles.map(p => ({
          id: p.id,
          puzzleNumber: p.puzzleNumber,
          gridSize: p.gridSize,
          difficulty: p.difficulty,
          categories: p.categories.map(c => ({
            themeWord: c.themeWord,
            words: c.words,
            similarity: c.similarity
          }))
        }))
      }
    });
  } catch (error) {
    logger.error('Error generating daily puzzles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate daily puzzles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/games/themes/admin/generate-today
 * Generate puzzles for today (convenience endpoint)
 */
router.post('/generate-today', async (req: Request, res: Response) => {
  try {
    const today = getCurrentDateString();
    const { puzzleGenerator } = getThemesServices();
    
    logger.info(`Starting puzzle generation for today: ${today}`);
    const puzzles = await puzzleGenerator.generateDailyPuzzles(today);

    res.json({
      success: true,
      data: {
        date: today,
        generated: puzzles.length,
        puzzles: puzzles.map(p => ({
          id: p.id,
          puzzleNumber: p.puzzleNumber,
          gridSize: p.gridSize,
          difficulty: p.difficulty,
          categories: p.categories.map(c => ({
            themeWord: c.themeWord,
            similarity: c.similarity
          }))
        }))
      }
    });
  } catch (error) {
    logger.error('Error generating today\'s puzzles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate today\'s puzzles',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/games/themes/admin/validate-puzzle/:date/:puzzleId
 * Validate a specific puzzle
 */
router.post('/validate-puzzle/:date/:puzzleId', async (req: Request, res: Response) => {
  try {
    const { date, puzzleId } = req.params;

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

    const validation = await puzzleGenerator.validatePuzzle(puzzle);

    res.json({
      success: true,
      data: {
        puzzle: {
          id: puzzle.id,
          date: puzzle.date,
          gridSize: puzzle.gridSize,
          difficulty: puzzle.difficulty
        },
        validation
      }
    });
  } catch (error) {
    logger.error('Error validating puzzle:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate puzzle',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/games/themes/admin/stats
 * Get system statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { 
      themesVectorService, 
      themesWordDataset, 
      tempUserService 
    } = getThemesServices();

    const vectorStats = await themesVectorService.getIndexStats();
    const datasetStats = await themesWordDataset.getDatasetStats();
    const tempUserStats = await tempUserService.getTempUserStats();

    res.json({
      success: true,
      data: {
        vector: vectorStats,
        dataset: datasetStats,
        tempUsers: tempUserStats,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    logger.error('Error getting admin stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get statistics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/games/themes/admin/cleanup-temp-users
 * Clean up expired temporary users
 */
router.post('/cleanup-temp-users', async (req: Request, res: Response) => {
  try {
    const { tempUserService } = getThemesServices();
    const result = await tempUserService.cleanupAllExpiredUsers();

    res.json({
      success: true,
      data: {
        cleaned: result.cleaned,
        errors: result.errors,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    logger.error('Error cleaning up temporary users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup temporary users',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/games/themes/admin/reinitialize-dataset
 * Reinitialize the word dataset (dangerous - for development only)
 */
router.post('/reinitialize-dataset', async (req: Request, res: Response) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      res.status(403).json({
        success: false,
        error: 'This operation is not allowed in production'
      });
      return;
    }

    const { themesWordDataset } = getThemesServices();
    
    logger.warn('Reinitializing word dataset - this may take a while...');
    await themesWordDataset.initializeDataset(true); // Force reload

    const stats = await themesWordDataset.getDatasetStats();

    res.json({
      success: true,
      data: {
        message: 'Dataset reinitialized successfully',
        stats,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    logger.error('Error reinitializing dataset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reinitialize dataset',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;