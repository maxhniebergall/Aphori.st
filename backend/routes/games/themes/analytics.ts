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
 * Helper function to get client IP address with robust proxy/load balancer support
 */
function getClientIp(req: Request): string {
  // Try various proxy headers (in order of reliability)
  const forwardedFor = req.headers['x-forwarded-for'] as string;
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs (comma-separated), take the first (original client)
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    const clientIp = ips[0];
    if (clientIp && isValidIp(clientIp)) {
      return clientIp;
    }
  }
  
  // Try other proxy headers
  const headers = [
    'x-real-ip',
    'x-client-ip',
    'x-forwarded',
    'forwarded-for',
    'forwarded'
  ];
  
  for (const header of headers) {
    const value = req.headers[header] as string;
    if (value && isValidIp(value)) {
      return value;
    }
  }
  
  // Fall back to connection properties
  const connectionIp = req.connection?.remoteAddress || 
                      req.socket?.remoteAddress || 
                      (req as any).ip; // Express may set req.ip
                      
  if (connectionIp && isValidIp(connectionIp)) {
    return connectionIp;
  }
  
  return 'unknown';
}

/**
 * Basic IP address validation
 */
function isValidIp(ip: string): boolean {
  if (!ip || ip === 'unknown') return false;
  
  // Remove IPv6 brackets and port if present
  ip = ip.replace(/^\[|\]$/g, '').split(':')[0];
  
  // Basic IPv4/IPv6 pattern check
  const ipv4Pattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Pattern = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;
  
  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
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

    // Validate puzzleNumber is a valid integer
    const parsedPuzzleNumber = parseInt(puzzleNumber.toString(), 10);
    if (!Number.isInteger(parsedPuzzleNumber)) {
      res.status(400).json({
        success: false,
        error: 'puzzleNumber must be a valid integer'
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
      puzzleNumber: parsedPuzzleNumber,
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

    // Validate puzzleNumber is a valid integer
    const puzzleNum = parseInt(puzzleNumber.toString(), 10);
    if (!Number.isInteger(puzzleNum)) {
      res.status(400).json({
        success: false,
        error: 'puzzleNumber must be a valid integer'
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
      puzzleNumber: puzzleNum,
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

export default router;