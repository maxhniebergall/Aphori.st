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
  ThemesPuzzleCompletion,
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
    if ((req as any).user && (req as any).user.id) {
      (req as any).effectiveUserId = (req as any).user.id;
      (req as any).userType = 'logged_in';
      return next();
    }

    // Handle temporary user
    const existingTempId = req.cookies?.temp_user_id;
    logger.info(`Temp user middleware: existingTempId=${existingTempId}, cookies=${JSON.stringify(req.cookies)}`);
    const tempUser = await tempUserService.getOrCreateTempUser(existingTempId);
    
    // Set cookie for temporary user (60 days)
    const cookieMaxAge = 60 * 24 * 60 * 60 * 1000; // 60 days in milliseconds
    res.cookie('temp_user_id', tempUser.tempId, {
      maxAge: cookieMaxAge,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    (req as any).effectiveUserId = tempUser.tempId;
    (req as any).userType = 'temporary';
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
 * Helper function to create completion metrics
 */
async function createCompletionMetrics(
  dbClient: any,
  userId: string,
  userType: 'logged_in' | 'temporary',
  puzzle: any,
  puzzleId: string,
  currentDate: string
): Promise<void> {
  try {
    // Get all user attempts for this puzzle
    const attemptsPath = THEMES_DB_PATHS.USER_ATTEMPTS(userId, currentDate);
    const allAttempts = await dbClient.getRawPath(attemptsPath) || {};
    
    const puzzleAttempts = Object.values(allAttempts).filter(
      (attempt: any) => attempt.puzzleId === puzzleId
    ) as ThemesAttempt[];

    if (puzzleAttempts.length === 0) return;

    // Sort attempts by timestamp
    puzzleAttempts.sort((a, b) => a.timestamp - b.timestamp);

    // Get first view time (from puzzle views)
    const userViewsPath = THEMES_DB_PATHS.USER_PUZZLE_VIEWS(userId);
    const userViews = await dbClient.getRawPath(userViewsPath) || {};
    
    let firstViewTime = puzzleAttempts[0].timestamp; // Fallback to first attempt
    for (const viewData of Object.values(userViews) as any[]) {
      if (viewData.puzzleId === puzzleId && viewData.timestamp < firstViewTime) {
        firstViewTime = viewData.timestamp;
        break;
      }
    }

    // Calculate completion metrics
    const completionTime = Date.now() - firstViewTime;
    const totalAttempts = puzzleAttempts.length;
    
    // Calculate category completion order
    const categoryCompletionOrder: string[] = [];
    const correctAttempts = puzzleAttempts.filter(attempt => attempt.result === 'correct');
    
    for (const attempt of correctAttempts) {
      // Find which category this attempt solved
      const solvedCategory = puzzle.categories.find((cat: any) => {
        const categoryWordSet = new Set(cat.words as string[]);
        const selectedWordSet = new Set(attempt.selectedWords);
        return categoryWordSet.size === selectedWordSet.size && 
               [...categoryWordSet].every(word => selectedWordSet.has(word as string));
      });
      
      if (solvedCategory && !categoryCompletionOrder.includes(solvedCategory.id)) {
        categoryCompletionOrder.push(solvedCategory.id);
      }
    }

    // Calculate average words per attempt
    const totalWordsSelected = puzzleAttempts.reduce((sum, attempt) => sum + attempt.selectedWords.length, 0);
    const averageWordsPerAttempt = totalWordsSelected / totalAttempts;

    // Calculate unique word selections
    const uniqueWords = new Set();
    puzzleAttempts.forEach(attempt => {
      attempt.selectedWords.forEach(word => uniqueWords.add(word));
    });

    // Extract set and puzzle number from puzzle ID
    const puzzleIdParts = puzzleId.split('_');
    const setName = puzzleIdParts[0] || 'unknown';
    const puzzleNumber = puzzle.puzzleNumber || 0;

    // Create completion record
    const completionId = generateAttemptId();
    const completion: ThemesPuzzleCompletion = {
      id: completionId,
      userId,
      userType,
      puzzleId,
      setName,
      puzzleNumber,
      totalAttempts,
      completionTime,
      categoryCompletionOrder,
      averageWordsPerAttempt: Math.round(averageWordsPerAttempt * 100) / 100,
      uniqueWordSelections: uniqueWords.size,
      timestamp: Date.now()
    };

    // Store completion metrics
    const completionPath = THEMES_DB_PATHS.COMPLETION_ENTRY(completionId);
    await dbClient.setRawPath(completionPath, completion);

    // Also store in user-specific index
    const userCompletionsPath = `${THEMES_DB_PATHS.USER_COMPLETIONS(userId)}/${completionId}`;
    await dbClient.setRawPath(userCompletionsPath, {
      completionId,
      puzzleId,
      setName,
      puzzleNumber,
      totalAttempts,
      completionTime,
      timestamp: completion.timestamp
    });

    logger.info(`Created completion metrics for ${userId}: ${puzzleId} (${totalAttempts} attempts, ${Math.round(completionTime/1000)}s)`);
  } catch (error) {
    logger.error('Error creating completion metrics:', error);
    // Don't throw - completion metrics are optional
  }
}

/**
 * GET /api/games/themes/state/attempts/:puzzleId
 * Get user's attempts for a specific puzzle
 */
router.get('/attempts/:puzzleId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { puzzleId } = req.params;
    const { dbClient } = getThemesServices();
    const userId = (req as TempUserRequest).effectiveUserId;
    const currentDate = getCurrentDateString();
    
    // Get all attempts for this user and date
    const attemptsPath = THEMES_DB_PATHS.USER_ATTEMPTS(userId, currentDate);
    const allAttempts = await dbClient.getRawPath(attemptsPath) || {};
    
    // Filter for the specific puzzle
    const puzzleAttempts = Object.values(allAttempts)
      .filter((attempt: any) => attempt.puzzleId === puzzleId)
      .sort((a: any, b: any) => a.timestamp - b.timestamp);
    
    res.json({
      success: true,
      data: {
        puzzleId,
        attempts: puzzleAttempts,
        totalAttempts: puzzleAttempts.length
      }
    });
  } catch (error) {
    logger.error('Error getting puzzle attempts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get puzzle attempts'
    });
  }
});

/**
 * GET /api/games/themes/state/progress
 * Get user's game progress
 */
router.get('/progress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { dbClient } = getThemesServices();
    const userId = (req as TempUserRequest).effectiveUserId;
    const userType = (req as TempUserRequest).userType;

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
router.post('/attempt', async (req: Request, res: Response): Promise<void> => {
  try {
    const { puzzleId, selectedWords, selectionOrder } = req.body;

    if (!puzzleId || !Array.isArray(selectedWords) || selectedWords.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: puzzleId, selectedWords'
      });
      return;
    }

    const { dbClient } = getThemesServices();
    const userId = (req as TempUserRequest).effectiveUserId;
    const userType = (req as TempUserRequest).userType;
    
    // Extract set name from puzzleId (format: setName_puzzleNumber)
    const puzzleIdParts = puzzleId.split('_');
    if (puzzleIdParts.length < 2) {
      res.status(400).json({
        success: false,
        error: 'Invalid puzzle ID format'
      });
      return;
    }
    
    // For puzzle sets, the format is setName_puzzleNumber (e.g., "wiki_batch_2025-08-20_1")
    // Extract set name by joining all parts except the last one
    const setName = puzzleIdParts.slice(0, -1).join('_');
    const currentDate = getCurrentDateString();

    // Get the puzzle from puzzle sets to validate the attempt
    let puzzle = null;
    
    // Search through all grid sizes in the puzzle set
    const puzzleSetPath = `puzzleSets/${setName}`;
    const puzzleSetData = await dbClient.getRawPath(puzzleSetPath);
    
    if (puzzleSetData) {
      // Search through all grid sizes for the puzzle
      for (const [, gridData] of Object.entries(puzzleSetData)) {
        if (gridData && typeof gridData === 'object') {
          const foundPuzzle = (gridData as any)[puzzleId];
          if (foundPuzzle) {
            puzzle = foundPuzzle;
            break;
          }
        }
      }
    }
    
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
      
      // Track distinct solved categories by creating a Set of unique category identifiers
      const solvedCategories = new Set<string>();
      
      // Add categories from previous correct attempts
      Object.values(existingAttempts).forEach((attempt: any) => {
        if (attempt.puzzleId === puzzleId && attempt.result === 'correct') {
          // Find which category this attempt solved
          const solvedCategory = puzzle.categories.find((cat: any) => {
            const categoryWordSet = new Set(cat.words as string[]);
            const selectedWordSet = new Set(attempt.selectedWords);
            return categoryWordSet.size === selectedWordSet.size && 
                   [...categoryWordSet].every(word => selectedWordSet.has(word as string));
          });
          if (solvedCategory && solvedCategory.id) {
            solvedCategories.add(solvedCategory.id);
          }
        }
      });
      
      // Add the current attempt's category
      const currentSolvedCategory = puzzle.categories.find((cat: any) => {
        const categoryWordSet = new Set(cat.words as string[]);
        const selectedWordSet = new Set(selectedWords);
        return categoryWordSet.size === selectedWordSet.size && 
               [...categoryWordSet].every(word => selectedWordSet.has(word as string));
      });
      if (currentSolvedCategory && currentSolvedCategory.id) {
        solvedCategories.add(currentSolvedCategory.id);
      }

      // Puzzle is completed when all categories are found
      completedPuzzle = solvedCategories.size >= puzzle.categories.length;
    }

    // Create attempt record
    const attemptId = generateAttemptId();
    const attempt: ThemesAttempt = {
      id: attemptId,
      userId,
      userType,
      puzzleId,
      selectedWords,
      selectionOrder: selectionOrder || [],
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
      
      // Create enhanced completion metrics
      await createCompletionMetrics(dbClient, userId, userType, puzzle, puzzleId, currentDate);
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
 * GET /api/games/themes/state/shareable/:setName/:puzzleNumber
 * Get shareable results for a specific puzzle
 */
router.get('/shareable/:setName/:puzzleNumber', async (req: Request, res: Response): Promise<void> => {
  try {
    const { setName, puzzleNumber } = req.params;
    const userId = (req as TempUserRequest).effectiveUserId;
    const userType = (req as TempUserRequest).userType;
    const { dbClient } = getThemesServices();
    
    logger.info(`Shareable request: userId=${userId}, userType=${userType}, setName=${setName}, puzzleNumber=${puzzleNumber}`);
    
    const puzzleNum = parseInt(puzzleNumber, 10);
    if (isNaN(puzzleNum)) {
      res.status(400).json({
        success: false,
        error: 'Invalid puzzle number'
      });
      return;
    }

    // Construct the specific puzzle ID
    const puzzleId = `${setName}_${puzzleNum}`;

    // Get all user attempts and filter for this specific puzzle
    const currentDate = getCurrentDateString();
    const attemptsPath = THEMES_DB_PATHS.USER_ATTEMPTS(userId, currentDate);
    logger.info(`Looking for attempts at path: ${attemptsPath}`);
    const allAttempts = await dbClient.getRawPath(attemptsPath) || {};
    logger.info(`Found ${Object.keys(allAttempts).length} total attempts for user`);
    
    // Filter attempts for this specific puzzle
    const puzzleAttempts: Record<string, any> = {};
    for (const [attemptId, attempt] of Object.entries(allAttempts)) {
      if (attempt && typeof attempt === 'object' && 
          (attempt as any).puzzleId === puzzleId) {
        puzzleAttempts[attemptId] = attempt;
      }
    }
    logger.info(`Found ${Object.keys(puzzleAttempts).length} attempts for puzzle ${puzzleId}`);
    
    // Get the specific puzzle from the puzzle set
    const puzzlesPath = `puzzleSets/${setName}`;
    const puzzleSetData = await dbClient.getRawPath(puzzlesPath) || {};
    
    // Find the specific puzzle
    let targetPuzzle = null;
    if (puzzleSetData) {
      for (const [, gridData] of Object.entries(puzzleSetData)) {
        if (gridData && typeof gridData === 'object') {
          const foundPuzzle = (gridData as any)[puzzleId];
          if (foundPuzzle) {
            targetPuzzle = foundPuzzle;
            break;
          }
        }
      }
    }
    
    if (!targetPuzzle) {
      res.status(404).json({
        success: false,
        error: 'Puzzle not found'
      });
      return;
    }

    // Create a puzzles data structure with just this one puzzle
    // Ensure the puzzle object has the correct id field for state management
    const puzzleWithId = {
      ...targetPuzzle,
      id: puzzleId
    };
    const puzzlesData: Record<string, any> = {
      [puzzleId]: puzzleWithId
    };

    // Generate shareable content
    const shareableContent = generateShareableContent(puzzleAttempts, puzzlesData, setName, puzzleNum);
    
    res.json({
      success: true,
      data: shareableContent
    });
  } catch (error) {
    logger.error('Error getting shareable results:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get shareable results'
    });
  }
});

/**
 * Generate shareable content with emoji representation
 */
function generateShareableContent(attempts: any, puzzlesData: any, date: string, puzzleNumber?: number) {
  // Difficulty to emoji mapping (yellow, green, blue, purple based on standard Connections colors)
  const difficultyEmojis = {
    1: '🟨', // Yellow - Easiest
    2: '🟩', // Green - Medium-Easy  
    3: '🟦', // Blue - Medium-Hard
    4: '🟪'  // Purple - Hardest
  };

  const puzzles = Object.values(puzzlesData) as any[];
  
  // Process each puzzle - calculate attempts for ALL puzzles, not just completed ones
  const allPuzzleResults = puzzles.map(puzzle => {
    const puzzleAttempts = Object.values(attempts).filter(
      (attempt: any) => attempt.puzzleId === puzzle.id
    ) as any[];

    // Sort attempts by timestamp to get the correct order
    puzzleAttempts.sort((a, b) => a.timestamp - b.timestamp);

    const isCompleted = puzzleAttempts.some((attempt: any) => attempt.completedPuzzle);
    
    // Only generate emoji rows for completed puzzles
    let emojiRows: string[] = [];
    if (isCompleted) {
      // Create a map to track the order categories were solved
      const categoryOrder: any[] = [];
      
      // Go through attempts in order and track when each category was solved
      for (const attempt of puzzleAttempts) {
        if (attempt.result === 'correct') {
          // Find which category this attempt solved
          const solvedCategory = puzzle.categories.find((cat: any) => {
            const categoryWordSet = new Set(cat.words as string[]);
            const selectedWordSet = new Set(attempt.selectedWords);
            return categoryWordSet.size === selectedWordSet.size && 
                   [...categoryWordSet].every(word => selectedWordSet.has(word as string));
          });
          
          if (solvedCategory && !categoryOrder.find(c => c.id === solvedCategory.id)) {
            categoryOrder.push(solvedCategory);
          }
        }
      }
      
      // Generate emoji rows in the order categories were solved
      emojiRows = categoryOrder.map(category => {
        const emoji = difficultyEmojis[category.difficulty as keyof typeof difficultyEmojis];
        return `${emoji}${emoji}${emoji}${emoji}`;
      });
    }

    return {
      puzzleNumber: puzzle.puzzleNumber,
      attempts: puzzleAttempts.length,
      completed: isCompleted,
      emojiRows
    };
  });

  // Filter for shareable display (only completed puzzles)
  const shareableResults = allPuzzleResults.filter(result => result.completed);
  
  // Calculate summary statistics using ALL puzzle results (not just completed ones)
  const completedCount = shareableResults.length;
  const totalPuzzles = allPuzzleResults.length; // Total puzzles we have data for
  const totalAttempts = allPuzzleResults.reduce((sum, p) => sum + p.attempts, 0); // ALL attempts
  
  // Create the puzzle link using the actual setName and puzzleNumber
  const puzzleLink = puzzleNumber 
    ? `https://aphori.st/games/themes/${date}/puzzle/${puzzleNumber}`
    : `https://aphori.st/games/themes/${date}`;
  
  const shareableText = [
    ...shareableResults.flatMap(puzzle => [
      `Puzzle ${puzzle.puzzleNumber}:`,
      ...puzzle.emojiRows,
      ''
    ]),
    puzzleLink
  ].join('\n').trim();

  return {
    date,
    shareableText,
    puzzleResults: shareableResults,
    summary: {
      completedPuzzles: completedCount,
      totalPuzzles: totalPuzzles,
      totalAttempts: totalAttempts
    }
  };
}

export default router;