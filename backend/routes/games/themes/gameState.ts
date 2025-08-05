/**
 * Game State API Routes
 * Handles user progress, attempts, and temporary users
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getThemesServices } from './index.js';
import { optionalAuthMiddleware } from '../../../middleware/optionalAuthMiddleware.js';

// Interface for requests that have been processed by handleTempUser middleware
interface TempUserRequest extends Request {
  effectiveUserId: string;
  userType: 'logged_in' | 'temporary';
  user?: any; // From optionalAuthMiddleware
}
import { 
  generateAttemptId,
  getCurrentDateString 
} from '../../../config/database/games.js';
import { 
  ThemesAttempt, 
  ThemesGameState,
  THEMES_DB_PATHS,
  isTemporaryUserId 
} from '../../../types/games/themes.js';
import logger from '../../../logger.js';

const router = Router();

// Apply optional auth middleware to all routes
router.use(optionalAuthMiddleware);

/**
 * Middleware to handle temporary users
 * Creates or validates temporary user from cookies
 */
async function handleTempUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempUserService } = getThemesServices();
    
    // Check if user is logged in
    if (req.user && req.user.id) {
      req.effectiveUserId = req.user.id;
      req.userType = 'logged_in';
      return next();
    }

    // Handle temporary user
    const existingTempId = req.cookies?.temp_user_id;
    const tempUser = await tempUserService.getOrCreateTempUser(existingTempId);
    
    // Set cookie for temporary user (60 days)
    const cookieMaxAge = 60 * 24 * 60 * 60 * 1000; // 60 days in milliseconds
    res.cookie('temp_user_id', tempUser.tempId, {
      maxAge: cookieMaxAge,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    req.effectiveUserId = tempUser.tempId;
    req.userType = 'temporary';
    next();
  } catch (error) {
    logger.error('Error handling temporary user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize user session'
    });
  }
}

router.use(handleTempUser);

/**
 * GET /api/games/themes/state/progress
 * Get user's game progress
 */
router.get('/progress', async (req: TempUserRequest, res: Response) => {
  try {
    const { dbClient } = getThemesServices();
    const userId = req.effectiveUserId;
    const userType = req.userType;

    // Get progress path based on user type
    const progressPath = userType === 'logged_in' 
      ? THEMES_DB_PATHS.USER_PROGRESS(userId)
      : THEMES_DB_PATHS.TEMP_USER_PROGRESS(userId);

    const progress = await dbClient.getRawPath(progressPath);

    // Default progress if none exists
    const defaultProgress: ThemesGameState = {
      userId,
      userType,
      currentDate: getCurrentDateString(),
      completedPuzzles: [],
      currentPuzzleIndex: 0,
      totalAttempts: 0,
      lastAccessed: Date.now()
    };

    res.json({
      success: true,
      data: progress || defaultProgress
    });
  } catch (error) {
    logger.error('Error getting user progress:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user progress'
    });
  }
});

/**
 * POST /api/games/themes/state/attempt
 * Submit a puzzle attempt
 */
router.post('/attempt', async (req: TempUserRequest, res: Response) => {
  try {
    const { puzzleId, selectedWords } = req.body;

    if (!puzzleId || !Array.isArray(selectedWords) || selectedWords.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: puzzleId, selectedWords'
      });
      return;
    }

    const { dbClient } = getThemesServices();
    const userId = req.effectiveUserId;
    const userType = req.userType;
    
    // Extract date from puzzleId (format: themes_YYYY-MM-DD_N)
    const puzzleIdParts = puzzleId.split('_');
    if (puzzleIdParts.length < 3 || !puzzleIdParts[1]) {
      res.status(400).json({
        success: false,
        error: 'Invalid puzzle ID format'
      });
      return;
    }
    
    const puzzleDate = puzzleIdParts[1]; // Extract date from puzzleId
    const currentDate = getCurrentDateString();

    // Get the puzzle to validate the attempt
    const puzzlePath = `games/themes/daily/${puzzleDate}/${puzzleId}`;
    const puzzle = await dbClient.getRawPath(puzzlePath);
    if (!puzzle) {
      res.status(404).json({
        success: false,
        error: 'Puzzle not found'
      });
      return;
    }

    // Validate attempt (check if selected words form a complete category)
    let result: 'correct' | 'incorrect' = 'incorrect';
    let distance = selectedWords.length; // Default to maximum distance
    let completedPuzzle = false;

    // Check if selected words match any category exactly
    for (const category of puzzle.categories) {
      const categoryWordSet = new Set(category.words);
      const selectedWordSet = new Set(selectedWords);
      
      if (categoryWordSet.size === selectedWordSet.size && 
          [...categoryWordSet].every(word => selectedWordSet.has(word))) {
        result = 'correct';
        distance = 0;
        break;
      } else {
        // Calculate how many words are correct
        const correctWords = selectedWords.filter(word => categoryWordSet.has(word));
        const currentDistance = selectedWords.length - correctWords.length;
        distance = Math.min(distance, currentDistance);
      }
    }

    // Check if puzzle is completed (all categories found)
    if (result === 'correct') {
      // Get user's previous attempts for this puzzle
      const attemptsPath = THEMES_DB_PATHS.USER_ATTEMPTS(userId, currentDate);
      const existingAttempts = await dbClient.getRawPath(attemptsPath) || {};
      
      // Count correct attempts
      const correctAttempts = Object.values(existingAttempts).filter(
        (attempt: any) => attempt.puzzleId === puzzleId && attempt.result === 'correct'
      ).length;

      // Puzzle is completed when all categories are found
      completedPuzzle = (correctAttempts + 1) >= puzzle.categories.length;
    }

    // Create attempt record
    const attemptId = generateAttemptId();
    const attempt: ThemesAttempt = {
      id: attemptId,
      userId,
      userType,
      puzzleId,
      selectedWords,
      result,
      distance,
      timestamp: Date.now(),
      completedPuzzle
    };

    // Store attempt
    const attemptPath = THEMES_DB_PATHS.ATTEMPT(userId, currentDate, attemptId);
    await dbClient.setRawPath(attemptPath, attempt);

    // Update user progress if puzzle completed
    if (completedPuzzle) {
      const progressPath = userType === 'logged_in' 
        ? THEMES_DB_PATHS.USER_PROGRESS(userId)
        : THEMES_DB_PATHS.TEMP_USER_PROGRESS(userId);
      
      const currentProgress = await dbClient.getRawPath(progressPath) || {
        userId,
        userType,
        currentDate,
        completedPuzzles: [],
        currentPuzzleIndex: 0,
        totalAttempts: 0,
        lastAccessed: Date.now()
      };

      if (!currentProgress.completedPuzzles.includes(puzzleId)) {
        currentProgress.completedPuzzles.push(puzzleId);
        currentProgress.currentPuzzleIndex = currentProgress.completedPuzzles.length;
      }
      
      currentProgress.totalAttempts += 1;
      currentProgress.lastAccessed = Date.now();
      
      await dbClient.setRawPath(progressPath, currentProgress);
    }

    res.json({
      success: true,
      data: {
        attempt,
        puzzleCompleted: completedPuzzle,
        message: result === 'correct' 
          ? 'Correct!' 
          : distance === 1 
            ? 'One away!'
            : distance === 2
              ? 'Two away!'
              : distance === 3
                ? 'Three away!'
                : 'Keep trying!'
      }
    });
  } catch (error) {
    logger.error('Error submitting attempt:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit attempt'
    });
  }
});

/**
 * GET /api/games/themes/state/shareable/:date
 * Get shareable results for a specific date
 */
// TODO: Implement shareable results generation with emoji-based representation
router.get('/shareable/:date', async (req: TempUserRequest, res: Response) => {
  try {
    const { date } = req.params;
    const userId = req.effectiveUserId;

    // TODO: Implement shareable results generation
    // This would create an emoji-based representation of the user's attempts
    
    res.json({
      success: true,
      data: {
        message: 'Shareable results coming soon!',
        date,
        userId
      }
    });
  } catch (error) {
    logger.error('Error getting shareable results:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get shareable results'
    });
  }
});

export default router;