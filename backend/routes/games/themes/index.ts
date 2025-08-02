/**
 * Themes Game API Routes
 * Main router for all themes game endpoints
 */

import { Router } from 'express';
import { LoggedDatabaseClient } from '../../../db/LoggedDatabaseClient.js';
import { ThemesKNNService } from '../../../services/games/ThemesKNNService.js';
import { SimpleThemesPuzzleGenerator } from '../../../services/games/SimpleThemesPuzzleGenerator.js';
import { TemporaryUserService } from '../../../services/games/TemporaryUserService.js';

// Import individual route modules
import dailyPuzzlesRoutes from './dailyPuzzles.js';
import gameStateRoutes from './gameState.js';
import adminRoutes from './admin.js';

// Global services that will be injected
let dbClient: LoggedDatabaseClient;
let knnService: ThemesKNNService;
let puzzleGenerator: SimpleThemesPuzzleGenerator;
let tempUserService: TemporaryUserService;

const router = Router();

/**
 * Initialize themes services
 * This function should be called from the main server with initialized dependencies
 */
export function initializeThemesServices(db: LoggedDatabaseClient): void {
  dbClient = db;
  
  // Initialize simple services
  knnService = new ThemesKNNService();
  puzzleGenerator = new SimpleThemesPuzzleGenerator(knnService);
  tempUserService = new TemporaryUserService(db);
}

/**
 * Initialize themes index
 * Should be called after services are initialized
 */
export async function initializeThemesIndex(): Promise<void> {
  if (!knnService) {
    throw new Error('Themes services not initialized');
  }
  
  await knnService.initialize();
}

/**
 * Get themes services for use in route handlers
 */
export function getThemesServices() {
  if (!dbClient || !knnService || !puzzleGenerator || !tempUserService) {
    throw new Error('Themes services not initialized');
  }
  
  return {
    dbClient,
    knnService,
    puzzleGenerator,
    tempUserService
  };
}

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const services = getThemesServices();
    const knnStats = services.knnService.getStats();
    const tempUserStats = await services.tempUserService.getTempUserStats();
    
    res.json({
      success: true,
      status: 'healthy',
      services: {
        knn: {
          totalWords: knnStats.totalWords,
          dimension: knnStats.dimension,
          initialized: knnStats.initialized
        },
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
router.use('/state', gameStateRoutes);
router.use('/admin', adminRoutes);

export default router;