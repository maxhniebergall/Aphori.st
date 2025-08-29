/**
 * Game State API Routes
 * Handles user progress, attempts, and temporary users
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
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
    logger.info(`Temp user middleware: hasTempId=${Boolean(existingTempId)}`);
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
 * Generate canonical signature for idempotency
 * Creates deterministic hash from normalized word selection
 */
function generateAttemptSignature(puzzleId: string, selectedWords: string[]): string {
  // Normalize words: case-insensitive, trimmed, sorted for consistent ordering
  const normalizedWords = selectedWords
    .map(w => w.toLowerCase().trim())
    .sort();
  
  // Create canonical representation with separator that won't appear in words
  const canonical = `${puzzleId}|${normalizedWords.join('\u0001')}`;
  
  // Generate SHA-256 hash
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Helper function to create completion metrics
 */
async function createCompletionMetrics(
  dbClient: any,
  userId: string,
  userType: 'logged_in' | 'temporary',
  puzzle: any,
  puzzleId: string
): Promise<void> {
  try {
    // Get attempt IDs from the new index
    const attemptIndexPath = `/indexes/themesUserAttemptsByPuzzle/${userId}/${puzzleId}`;
    const attemptIds = await dbClient.getRawPath(attemptIndexPath) || {};
    
    if (Object.keys(attemptIds).length === 0) return;

    // Hydrate only the specific attempts for this puzzle
    const puzzleAttempts: ThemesAttempt[] = [];
    const attemptsPath = THEMES_DB_PATHS.USER_ATTEMPTS(userId);
    
    for (const attemptId of Object.keys(attemptIds)) {
      const attemptPath = `${attemptsPath}/${attemptId}`;
      const attempt = await dbClient.getRawPath(attemptPath);
      if (attempt && attempt.puzzleId === puzzleId) {
        puzzleAttempts.push(attempt as ThemesAttempt);
      }
    }

    if (puzzleAttempts.length === 0) return;

    // Sort attempts by timestamp
    puzzleAttempts.sort((a, b) => a.timestamp - b.timestamp);

    // Get first view time by scanning all matching view timestamps and taking minimum
    const userViewsPath = THEMES_DB_PATHS.USER_PUZZLE_VIEWS(userId);
    const userViews = await dbClient.getRawPath(userViewsPath) || {};
    
    let firstViewTime = puzzleAttempts[0].timestamp; // Fallback to first attempt
    // Scan all view timestamps for this puzzle and take the minimum
    for (const viewData of Object.values(userViews) as any[]) {
      if (viewData.puzzleId === puzzleId && viewData.timestamp < firstViewTime) {
        firstViewTime = viewData.timestamp;
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

    // Extract set name by trimming only the final numeric suffix
    const puzzleIdParts = puzzleId.split('_');
    const lastPart = puzzleIdParts[puzzleIdParts.length - 1];
    const isLastPartNumeric = /^\d+$/.test(lastPart);
    const setName = isLastPartNumeric 
      ? puzzleIdParts.slice(0, -1).join('_') 
      : puzzleId;
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
    
    // Get attempt IDs from the new index
    const attemptIndexPath = `/indexes/themesUserAttemptsByPuzzle/${userId}/${puzzleId}`;
    const attemptIds = await dbClient.getRawPath(attemptIndexPath) || {};
    
    // Hydrate only the specific attempts for this puzzle
    const puzzleAttempts: any[] = [];
    const attemptsPath = THEMES_DB_PATHS.USER_ATTEMPTS(userId);
    
    for (const attemptId of Object.keys(attemptIds)) {
      const attemptPath = `${attemptsPath}/${attemptId}`;
      const attempt = await dbClient.getRawPath(attemptPath);
      if (attempt && attempt.puzzleId === puzzleId) {
        puzzleAttempts.push(attempt);
      }
    }
    
    // Sort attempts by timestamp
    puzzleAttempts.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
    
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
 * GET /api/games/themes/state/completed-puzzles/:setName
 * Get user's completed puzzles for a specific set
 */
router.get('/completed-puzzles/:setName', async (req: Request, res: Response): Promise<void> => {
  try {
    const { setName } = req.params;
    const { dbClient } = getThemesServices();
    const userId = (req as TempUserRequest).effectiveUserId;
    const userType = (req as TempUserRequest).userType;

    // Get progress path based on user type
    const progressPath = userType === 'logged_in' 
      ? THEMES_DB_PATHS.USER_PROGRESS(userId)
      : THEMES_DB_PATHS.TEMP_USER_PROGRESS(userId);

    const progress = await dbClient.getRawPath(progressPath);

    // Extract completed puzzles for this specific set
    const completedPuzzles = progress?.completedPuzzles || [];
    const setCompletedPuzzles = completedPuzzles
      .filter((puzzleId: string) => puzzleId.startsWith(setName + '_'))
      .map((puzzleId: string) => {
        // Extract puzzle number from puzzleId (format: setName_puzzleNumber)
        const parts = puzzleId.split('_');
        const puzzleNumber = parseInt(parts[parts.length - 1], 10);
        return puzzleNumber;
      })
      .filter((num: number) => !isNaN(num));

    res.json({
      success: true,
      data: {
        setName,
        completedPuzzles: setCompletedPuzzles,
        totalCompleted: setCompletedPuzzles.length
      }
    });
  } catch (error) {
    logger.error('Error getting completed puzzles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get completed puzzles'
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
    
    // Extract set name by checking if last part is numeric and trimming only final numeric suffix
    const lastPart = puzzleIdParts[puzzleIdParts.length - 1];
    const isLastPartNumeric = /^\d+$/.test(lastPart);
    const setName = isLastPartNumeric 
      ? puzzleIdParts.slice(0, -1).join('_') 
      : puzzleId;

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

    // Compute canonical signature for idempotency (case/trim-insensitive, order-insensitive)
    const signature = generateAttemptSignature(puzzleId, selectedWords);
    
    // Fast path: check signature index to short-circuit obvious duplicates
    const sigPath = `/indexes/themesAttemptSignatures/${userId}/${puzzleId}/${signature}`;
    const existingSig = await dbClient.getRawPath(sigPath);
    let isDuplicate = Boolean(existingSig);
    
    if (!isDuplicate) {
      // Transactionally reserve the signature; if it already exists, another request beat us
      try {
        const reservationResult = await dbClient.runTransaction(sigPath, (currentValue: any) => {
          if (currentValue) {
            // Signature already exists, this is a duplicate
            return currentValue;
          } else {
            // Reserve the signature with timestamp
            return { ts: Date.now(), reserved: true };
          }
        });
        
        // If transaction succeeded and committed, check if we reserved it or it already existed
        if (reservationResult.committed && reservationResult.snapshot) {
          // If the returned value doesn't have our reservation flag, someone else got there first
          isDuplicate = !reservationResult.snapshot.reserved;
        }
      } catch (error) {
        logger.error('Error in signature reservation transaction:', error);
        // Fall back to traditional duplicate check on transaction failure
      }
    }
    
    // Fallback scan for backward compatibility (kept until all writers use signatures)
    if (!isDuplicate) {
      const attemptsPath = THEMES_DB_PATHS.USER_ATTEMPTS(userId);
      const existingAttempts = await dbClient.getRawPath(attemptsPath) || {};
      const selectedWordSet = new Set(selectedWords.map(w => w.toLowerCase().trim()));
      isDuplicate = Object.values(existingAttempts).some((attempt: any) => {
        if (attempt.puzzleId === puzzleId) {
          const attemptWordSet = new Set(attempt.selectedWords.map((w: string) => w.toLowerCase().trim()));
          return selectedWordSet.size === attemptWordSet.size && 
                 [...selectedWordSet].every(word => attemptWordSet.has(word));
        }
        return false;
      });
    }

    // If duplicate, return early without creating a new attempt or incrementing counter
    if (isDuplicate) {
      res.json({
        success: true,
        data: {
          attempt: {
            result: 'duplicate'
          },
          puzzleCompleted: false,
          message: "You've already tried those words!"
        }
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
      // We already have existingAttempts from the duplicate check above
      
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
    const attemptPath = THEMES_DB_PATHS.ATTEMPT(userId, attemptId);
    await dbClient.setRawPath(attemptPath, attempt);
    
    // Maintain per-puzzle attempt index for performance
    const attemptIndexPath = `/indexes/themesUserAttemptsByPuzzle/${userId}/${puzzleId}/${attemptId}`;
    await dbClient.setRawPath(attemptIndexPath, { ts: attempt.timestamp });
    
    // Ensure signature index is set with final attempt data
    await dbClient.setRawPath(sigPath, { ts: attempt.timestamp, attemptId });

    // Update user progress if puzzle completed
    if (completedPuzzle) {
      const progressPath = userType === 'logged_in' 
        ? THEMES_DB_PATHS.USER_PROGRESS(userId)
        : THEMES_DB_PATHS.TEMP_USER_PROGRESS(userId);
      
      const currentDate = getCurrentDateString();
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
      await createCompletionMetrics(dbClient, userId, userType, puzzle, puzzleId);
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

    // Get attempt IDs from the new index
    const attemptIndexPath = `/indexes/themesUserAttemptsByPuzzle/${userId}/${puzzleId}`;
    const attemptIds = await dbClient.getRawPath(attemptIndexPath) || {};
    logger.info(`Looking for attempts using index: ${attemptIndexPath}`);
    logger.info(`Found ${Object.keys(attemptIds).length} attempt IDs for puzzle ${puzzleId}`);
    
    // Hydrate only the specific attempts for this puzzle
    const puzzleAttempts: Record<string, any> = {};
    const attemptsPath = THEMES_DB_PATHS.USER_ATTEMPTS(userId);
    
    for (const attemptId of Object.keys(attemptIds)) {
      const attemptPath = `${attemptsPath}/${attemptId}`;
      const attempt = await dbClient.getRawPath(attemptPath);
      if (attempt && attempt.puzzleId === puzzleId) {
        puzzleAttempts[attemptId] = attempt;
      }
    }
    logger.info(`Hydrated ${Object.keys(puzzleAttempts).length} attempts for puzzle ${puzzleId}`);
    
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