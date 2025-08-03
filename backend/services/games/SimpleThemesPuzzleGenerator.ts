/**
 * Simple Themes Puzzle Generator
 * Uses KNN to create Connections-style puzzles
 */

import { ThemesKNNService } from './ThemesKNNService.js';
import { ThemesPuzzle, ThemesCategory, THEMES_DB_PATHS } from '../../types/games/themes.js';
import { LoggedDatabaseClient } from '../../db/LoggedDatabaseClient.js';
import logger from '../../logger.js';

export class SimpleThemesPuzzleGenerator {
  private knnService: ThemesKNNService;
  private dbClient?: LoggedDatabaseClient;
  private puzzleCache: Map<string, ThemesPuzzle[]> = new Map(); // Cache puzzles by date

  constructor(knnService: ThemesKNNService, dbClient?: LoggedDatabaseClient) {
    this.knnService = knnService;
    this.dbClient = dbClient;
  }

  // Runtime puzzle generation removed - all puzzles must be pregenerated

  // Runtime category generation removed - all puzzles must be pregenerated

  // Runtime theme guessing removed - all puzzles must be pregenerated

  // Runtime daily puzzle generation removed - all puzzles must be pregenerated

  /**
   * Get daily puzzles from database first, fallback to generation
   */
  async getDailyPuzzles(date: string): Promise<ThemesPuzzle[]> {
    try {
      // Try to load from database first
      if (this.dbClient) {
        const dailyPath = THEMES_DB_PATHS.DAILY_PUZZLES(date);
        logger.info(`Attempting to load puzzles from path: ${dailyPath}`);
        const dailyData = await this.dbClient.getRawPath(dailyPath);
        
        logger.info(`Database response for ${date}:`, {
          hasData: !!dailyData,
          dataType: typeof dailyData,
          keys: dailyData ? Object.keys(dailyData) : 'no data'
        });
        
        if (dailyData) {
          logger.debug(`Loading pre-generated puzzles from database for ${date}`);
          
          // Extract puzzles from the daily data
          const puzzles: ThemesPuzzle[] = [];
          for (const [key, value] of Object.entries(dailyData)) {
            if (key.startsWith('themes_') && value && typeof value === 'object') {
              puzzles.push(value as ThemesPuzzle);
            }
          }
          
          if (puzzles.length > 0) {
            // Sort by puzzle number
            puzzles.sort((a, b) => a.puzzleNumber - b.puzzleNumber);
            
            // Cache the loaded puzzles
            this.puzzleCache.set(date, puzzles);
            
            logger.info(`Loaded ${puzzles.length} pre-generated puzzles for ${date}`);
            return puzzles;
          }
        }
      }
      
      // No fallback generation - puzzles must be pre-generated
      logger.error(`No pre-generated puzzles found for ${date} and fallback generation is disabled`);
      throw new Error(`No puzzles found for date ${date}. Puzzles must be pre-generated and uploaded to the database.`);
    } catch (error) {
      logger.error(`Failed to get daily puzzles for ${date}:`, error);
      // Re-throw the error instead of falling back to generation
      throw error;
    }
  }

  /**
   * Get a specific puzzle by date and puzzleId
   * For the game state route compatibility
   */
  async getPuzzle(date: string, puzzleId: string): Promise<ThemesPuzzle | null> {
    try {
      // Use getDailyPuzzles to get cached or loaded puzzles
      const puzzles = await this.getDailyPuzzles(date);
      return puzzles.find(p => p.id === puzzleId) || null;
    } catch (error) {
      logger.error('Failed to get puzzle:', error);
      return null;
    }
  }
}