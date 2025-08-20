/**
 * Themes Game API Routes
 * Main router for all themes game endpoints
 */

import { Router } from 'express';
import { LoggedDatabaseClient } from '../../../db/LoggedDatabaseClient.js';
import { createThemesDatabaseClient } from '../../../db/index.js';
import { TemporaryUserService } from '../../../services/games/TemporaryUserService.js';

// Import individual route modules
import dailyPuzzlesRoutes from './dailyPuzzles.js';
import puzzleSetsRoutes from './puzzleSets.js';
import gameStateRoutes from './gameState.js';
import analyticsRoutes from './analytics.js';
// import adminRoutes from './admin.js';

// Global services that will be injected
let dbClient: LoggedDatabaseClient;
let tempUserService: TemporaryUserService;

const router = Router();

/**
 * Initialize themes services
 * Creates separate database connection to aphorist-themes Firebase RTDB
 */
export function initializeThemesServices(): void {
  // Create themes-specific database client
  dbClient = createThemesDatabaseClient();
  
  // Initialize simple services with themes database
  tempUserService = new TemporaryUserService(dbClient);
}

/**
 * Initialize themes index
 * Vector services removed - themes now use pregenerated puzzles only
 */
export async function initializeThemesIndex(): Promise<void> {
  // No initialization needed for pregenerated puzzles
  return Promise.resolve();
}

/**
 * Get themes services for use in route handlers
 */
export function getThemesServices() {
  if (!dbClient || !tempUserService) {
    throw new Error('Themes services not initialized');
  }
  
  return {
    dbClient,
    tempUserService
  };
}

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const services = getThemesServices();
    const tempUserStats = await services.tempUserService.getTempUserStats();
    
    res.json({
      success: true,
      status: 'healthy',
      message: 'Themes service ready (using pregenerated puzzles)',
      services: {
        tempUsers: {
          total: tempUserStats.total,
          active: tempUserStats.active,
          expired: tempUserStats.expired
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Themes services not ready',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Mount sub-routes
router.use('/daily', dailyPuzzlesRoutes);
router.use('/sets', puzzleSetsRoutes);
router.use('/state', gameStateRoutes);
router.use('/analytics', analyticsRoutes);
// Temporarily disabled due to TypeScript errors
// router.use('/admin', adminRoutes);

export default router;