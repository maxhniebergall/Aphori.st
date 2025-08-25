/**
 * Puzzle Sets API Routes
 * Handles puzzle retrieval by game sets instead of daily puzzles
 */

import { Router, Request, Response } from 'express';
import { getThemesServices } from './index.js';
import logger from '../../../logger.js';

const router = Router();

/**
 * Validates setName parameter to prevent path traversal attacks
 * Only allows alphanumeric characters, hyphens, and underscores
 */
function validateSetName(setName: string): boolean {
  if (!setName || typeof setName !== 'string') {
    return false;
  }
  
  // Allow only alphanumeric characters, hyphens, and underscores
  // Length should be reasonable (1-50 characters)
  const validPattern = /^[a-zA-Z0-9_-]{1,50}$/;
  return validPattern.test(setName);
}

/**
 * Validates version parameter to prevent path traversal attacks
 * Only allows alphanumeric characters, hyphens, underscores, and dots
 */
function validateVersion(version: string): boolean {
  if (!version || typeof version !== 'string') {
    return false;
  }
  
  // Allow only alphanumeric characters, hyphens, underscores, and dots
  // Length should be reasonable (1-50 characters)
  const validPattern = /^[a-zA-Z0-9_.-]{1,50}$/;
  return validPattern.test(version);
}

/**
 * GET /api/games/themes/sets
 * Get available puzzle sets
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { dbClient } = getThemesServices();
    
    // Fetch available sets from puzzleSets
    const setsPath = 'puzzleSets';
    logger.info(`Fetching puzzle sets from path: ${setsPath}`);
    const setsData = await dbClient.getRawPath(setsPath);
    
    if (!setsData) {
      res.json({
        success: true,
        data: {
          sets: []
        }
      });
      return;
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
router.get('/:setName/:version', async (req: Request, res: Response): Promise<void> => {
  try {
    const { setName, version } = req.params;
    
    // Validate setName to prevent path traversal attacks
    if (!validateSetName(setName)) {
      res.status(400).json({
        success: false,
        error: 'Invalid set name. Only alphanumeric characters, hyphens, and underscores are allowed.'
      });
      return;
    }
    
    // Validate version to prevent path traversal attacks
    if (!validateVersion(version)) {
      res.status(400).json({
        success: false,
        error: 'Invalid version. Only alphanumeric characters, hyphens, underscores, and dots are allowed.'
      });
      return;
    }
    
    const { dbClient } = getThemesServices();
    
    // Fetch puzzles from the specific set
    const puzzlePath = `puzzleSets/${setName}`;
    logger.info(`Fetching puzzles from path: ${puzzlePath}`);
    const puzzleData = await dbClient.getRawPath(puzzlePath);
    
    if (!puzzleData) {
      res.status(404).json({
        success: false,
        error: 'Puzzle set not found'
      });
      return;
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
router.get('/:setName/:version/puzzle/:puzzleNumber', async (req: Request, res: Response): Promise<void> => {
  try {
    const { setName, version, puzzleNumber } = req.params;
    
    // Validate setName to prevent path traversal attacks
    if (!validateSetName(setName)) {
      res.status(400).json({
        success: false,
        error: 'Invalid set name. Only alphanumeric characters, hyphens, and underscores are allowed.'
      });
      return;
    }
    
    // Validate version to prevent path traversal attacks
    if (!validateVersion(version)) {
      res.status(400).json({
        success: false,
        error: 'Invalid version. Only alphanumeric characters, hyphens, underscores, and dots are allowed.'
      });
      return;
    }
    
    const { dbClient } = getThemesServices();
    const puzzleNum = parseInt(puzzleNumber, 10);
    
    if (isNaN(puzzleNum)) {
      res.status(400).json({
        success: false,
        error: 'Invalid puzzle number'
      });
      return;
    }
    
    // Fetch puzzles from the specific set
    const puzzlePath = `puzzleSets/${setName}`;
    logger.info(`Fetching puzzle ${puzzleNum} from path: ${puzzlePath}`);
    const puzzleData = await dbClient.getRawPath(puzzlePath);
    
    if (!puzzleData) {
      res.status(404).json({
        success: false,
        error: 'Puzzle set not found'
      });
      return;
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
      res.status(404).json({
        success: false,
        error: 'Puzzle not found'
      });
      return;
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