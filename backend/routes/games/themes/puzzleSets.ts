/**
 * Puzzle Sets API Routes
 * Handles puzzle retrieval by game sets instead of daily puzzles
 */

import { Router, Request, Response } from 'express';
import { getThemesServices } from './index.js';
import logger from '../../../logger.js';

const router = Router();

/**
 * GET /api/games/themes/sets
 * Get available puzzle sets
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { dbClient } = getThemesServices();
    
    // Fetch available sets from puzzleSets
    const setsPath = 'puzzleSets';
    logger.info(`Fetching puzzle sets from path: ${setsPath}`);
    const setsData = await dbClient.getRawPath(setsPath);
    
    if (!setsData) {
      return res.json({
        success: true,
        data: {
          sets: []
        }
      });
    }

    const sets = [];
    for (const [setName, setData] of Object.entries(setsData)) {
      if (setData && typeof setData === 'object') {
        // Count puzzles across all grid sizes
        let totalCount = 0;
        const sizeCounts: Record<string, number> = {};
        const availableSizes: string[] = [];
        
        for (const [gridSize, puzzles] of Object.entries(setData)) {
          if (puzzles && typeof puzzles === 'object') {
            const count = Object.keys(puzzles).length;
            totalCount += count;
            sizeCounts[gridSize] = count;
            availableSizes.push(gridSize);
          }
        }
        
        if (totalCount > 0) {
          sets.push({
            name: setName,
            versions: [{
              version: setName, // Using setName as version for the new format
              totalCount,
              lastUpdated: Date.now(), // We don't have this in the new format
              availableSizes,
              sizeCounts
            }]
          });
        }
      }
    }

    res.json({
      success: true,
      data: {
        sets
      }
    });
  } catch (error) {
    logger.error('Error getting puzzle sets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get puzzle sets',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/games/themes/sets/:setName/:version
 * Get all puzzles in a specific set and version
 */
router.get('/:setName/:version', async (req: Request, res: Response) => {
  try {
    const { setName, version } = req.params;
    const { dbClient } = getThemesServices();
    
    // Fetch puzzles from the specific set
    const puzzlePath = `puzzleSets/${setName}`;
    logger.info(`Fetching puzzles from path: ${puzzlePath}`);
    const puzzleData = await dbClient.getRawPath(puzzlePath);
    
    if (!puzzleData) {
      return res.status(404).json({
        success: false,
        error: 'Puzzle set not found'
      });
    }

    const puzzles = [];
    // Process all grid sizes
    for (const [gridSize, gridData] of Object.entries(puzzleData)) {
      if (gridData && typeof gridData === 'object') {
        for (const [puzzleId, puzzleValue] of Object.entries(gridData)) {
          if (puzzleValue && typeof puzzleValue === 'object') {
            puzzles.push(puzzleValue);
          }
        }
      }
    }
    
    // Sort by puzzle number
    puzzles.sort((a: any, b: any) => a.puzzleNumber - b.puzzleNumber);

    res.json({
      success: true,
      data: {
        setName,
        version,
        puzzles,
        count: puzzles.length
      }
    });
  } catch (error) {
    logger.error('Error getting puzzle set:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get puzzle set',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/games/themes/sets/:setName/:version/puzzle/:puzzleNumber
 * Get a specific puzzle by number from a set
 */
router.get('/:setName/:version/puzzle/:puzzleNumber', async (req: Request, res: Response) => {
  try {
    const { setName, version, puzzleNumber } = req.params;
    const { dbClient } = getThemesServices();
    const puzzleNum = parseInt(puzzleNumber, 10);
    
    if (isNaN(puzzleNum)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid puzzle number'
      });
    }
    
    // Fetch puzzles from the specific set
    const puzzlePath = `puzzleSets/${setName}`;
    logger.info(`Fetching puzzle ${puzzleNum} from path: ${puzzlePath}`);
    const puzzleData = await dbClient.getRawPath(puzzlePath);
    
    if (!puzzleData) {
      return res.status(404).json({
        success: false,
        error: 'Puzzle set not found'
      });
    }

    let targetPuzzle = null;
    // Search through all grid sizes for the puzzle number
    for (const [gridSize, gridData] of Object.entries(puzzleData)) {
      if (gridData && typeof gridData === 'object') {
        for (const [puzzleId, puzzleValue] of Object.entries(gridData)) {
          if (puzzleValue && typeof puzzleValue === 'object' && 
              (puzzleValue as any).puzzleNumber === puzzleNum) {
            targetPuzzle = puzzleValue;
            break;
          }
        }
        if (targetPuzzle) break;
      }
    }
    
    if (!targetPuzzle) {
      return res.status(404).json({
        success: false,
        error: 'Puzzle not found'
      });
    }

    res.json({
      success: true,
      data: {
        setName,
        version,
        puzzle: targetPuzzle
      }
    });
  } catch (error) {
    logger.error('Error getting specific puzzle:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get puzzle',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;