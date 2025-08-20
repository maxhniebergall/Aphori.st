/**
 * Analytics API Routes for Themes Game
 * Handles puzzle view tracking, feedback collection, and metrics
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getThemesServices } from './index.js';
import { optionalAuthMiddleware } from '../../../middleware/optionalAuthMiddleware.js';
import { 
  generateAttemptId,
  getCurrentDateString 
} from '../../../config/database/games.js';
import { 
  ThemesPuzzleView, 
  ThemesPuzzleFeedback,
  UserFingerprint,
  THEMES_DB_PATHS,
  isTemporaryUserId 
} from '../../../types/games/themes.js';
import logger from '../../../logger.js';

const router = Router();

// Interface for requests that have been processed by handleTempUser middleware
interface TempUserRequest extends Request {
  effectiveUserId: string;
  userType: 'logged_in' | 'temporary';
  user?: any; // From optionalAuthMiddleware
}

// Extend Request prototype to include our custom properties
declare global {
  namespace Express {
    interface Request {
      effectiveUserId?: string;
      userType?: 'logged_in' | 'temporary';
    }
  }
}

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
 * Helper function to extract user fingerprint from request
 */
function extractFingerprint(req: Request): UserFingerprint | undefined {
  const fingerprintData = req.body.fingerprint;
  if (!fingerprintData) return undefined;

  return {
    screenResolution: fingerprintData.screenResolution || 'unknown',
    timezone: fingerprintData.timezone || 'unknown',
    language: fingerprintData.language || 'unknown',
    platform: fingerprintData.platform || 'unknown',
    cookieEnabled: fingerprintData.cookieEnabled !== false,
    doNotTrack: fingerprintData.doNotTrack === true
  };
}

/**
 * Helper function to get client IP address
 */
function getClientIp(req: Request): string {
  return (
    req.headers['x-forwarded-for'] as string ||
    req.headers['x-real-ip'] as string ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * POST /api/games/themes/analytics/view
 * Track puzzle view
 */
router.post('/view', async (req: Request, res: Response) => {
  try {
    const { puzzleId, setName, puzzleNumber } = req.body;

    if (!puzzleId || !setName || !puzzleNumber) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: puzzleId, setName, puzzleNumber'
      });
      return;
    }

    const { dbClient } = getThemesServices();
    const userId = (req as any).effectiveUserId;
    const userType = (req as any).userType;
    
    // Create view record
    const viewId = generateAttemptId(); // Reuse the ID generator
    const view: ThemesPuzzleView = {
      id: viewId,
      userId,
      userType,
      puzzleId,
      setName,
      puzzleNumber: parseInt(puzzleNumber.toString(), 10),
      timestamp: Date.now(),
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      fingerprint: extractFingerprint(req)
    };

    // Store view record
    const viewPath = THEMES_DB_PATHS.PUZZLE_VIEW(viewId);
    await dbClient.setRawPath(viewPath, view);

    // Also store in user-specific index for easy querying
    const userViewsPath = `${THEMES_DB_PATHS.USER_PUZZLE_VIEWS(userId)}/${viewId}`;
    await dbClient.setRawPath(userViewsPath, {
      viewId,
      puzzleId,
      setName,
      puzzleNumber: view.puzzleNumber,
      timestamp: view.timestamp
    });

    logger.debug(`Tracked puzzle view: ${userId} viewed ${puzzleId}`);

    res.json({
      success: true,
      data: {
        viewId,
        message: 'View tracked successfully'
      }
    });
  } catch (error) {
    logger.error('Error tracking puzzle view:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track puzzle view'
    });
  }
});

/**
 * POST /api/games/themes/analytics/feedback
 * Submit puzzle feedback
 */
router.post('/feedback', async (req: Request, res: Response) => {
  try {
    const { puzzleId, setName, puzzleNumber, rating, comment } = req.body;

    if (!puzzleId || !setName || !puzzleNumber || !rating) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: puzzleId, setName, puzzleNumber, rating'
      });
      return;
    }

    // Validate rating
    const ratingNum = parseInt(rating.toString(), 10);
    if (ratingNum < 1 || ratingNum > 5) {
      res.status(400).json({
        success: false,
        error: 'Rating must be between 1 and 5'
      });
      return;
    }

    const { dbClient } = getThemesServices();
    const userId = (req as any).effectiveUserId;
    const userType = (req as any).userType;
    
    // Create feedback record
    const feedbackId = generateAttemptId(); // Reuse the ID generator
    const feedback: ThemesPuzzleFeedback = {
      id: feedbackId,
      userId,
      userType,
      puzzleId,
      setName,
      puzzleNumber: parseInt(puzzleNumber.toString(), 10),
      rating: ratingNum,
      comment: comment || '',
      timestamp: Date.now()
    };

    // Store feedback record
    const feedbackPath = THEMES_DB_PATHS.FEEDBACK_ENTRY(feedbackId);
    await dbClient.setRawPath(feedbackPath, feedback);

    // Also store in user-specific index for easy querying
    const userFeedbackPath = `${THEMES_DB_PATHS.USER_FEEDBACK(userId)}/${feedbackId}`;
    await dbClient.setRawPath(userFeedbackPath, {
      feedbackId,
      puzzleId,
      setName,
      puzzleNumber: feedback.puzzleNumber,
      rating: feedback.rating,
      timestamp: feedback.timestamp
    });

    logger.info(`Received puzzle feedback: ${userId} rated ${puzzleId} as ${rating}/5`);

    res.json({
      success: true,
      data: {
        feedbackId,
        message: 'Feedback submitted successfully'
      }
    });
  } catch (error) {
    logger.error('Error submitting puzzle feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit feedback'
    });
  }
});

/**
 * GET /api/games/themes/analytics/stats
 * Get basic analytics stats (admin endpoint)
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { dbClient } = getThemesServices();
    
    // Get puzzle views count
    const puzzleViews = await dbClient.getRawPath(THEMES_DB_PATHS.PUZZLE_VIEWS);
    const viewsCount = puzzleViews ? Object.keys(puzzleViews).length : 0;
    
    // Get feedback count
    const puzzleFeedback = await dbClient.getRawPath(THEMES_DB_PATHS.PUZZLE_FEEDBACK);
    const feedbackCount = puzzleFeedback ? Object.keys(puzzleFeedback).length : 0;
    
    // Calculate average rating
    let averageRating = 0;
    if (puzzleFeedback && feedbackCount > 0) {
      const ratings = Object.values(puzzleFeedback) as ThemesPuzzleFeedback[];
      const totalRating = ratings.reduce((sum, f) => sum + f.rating, 0);
      averageRating = totalRating / feedbackCount;
    }

    res.json({
      success: true,
      data: {
        puzzleViews: viewsCount,
        feedbackSubmissions: feedbackCount,
        averageRating: Math.round(averageRating * 100) / 100,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    logger.error('Error getting analytics stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get analytics stats'
    });
  }
});

export default router;