/**
 * Themes Puzzle Generator
 * Generates daily word puzzles using vector similarity for themed categories
 */

import { LoggedDatabaseClient } from '../../db/LoggedDatabaseClient.js';
import { ThemesVectorService, ThemesSimilarityResult } from './ThemesVectorService.js';
import { ThemesWordDataset } from './ThemesWordDataset.js';
import { 
  ThemesPuzzle, 
  ThemesCategory,
  THEMES_DB_PATHS,
  THEMES_CONFIG,
  isValidPuzzleSize 
} from '../../types/games/themes.js';
import { 
  generatePuzzleId,
  getCurrentDateString 
} from '../../config/database/games.js';
import logger from '../../logger.js';

export interface PuzzleGenerationOptions {
  date: string;
  puzzleNumber: number; // 1-7 for daily progression
  gridSize: number; // 4x4, 5x5, etc.
  minSimilarity?: number; // Minimum similarity within categories
  maxCrossSimilarity?: number; // Maximum similarity between categories
}

export interface CategoryCandidate {
  themeWord: string;
  similarWords: ThemesSimilarityResult[];
  averageSimilarity: number;
  categoryWords: string[];
}

export class ThemesPuzzleGenerator {
  private firebaseClient: LoggedDatabaseClient;
  private vectorService: ThemesVectorService;
  private wordDataset: ThemesWordDataset;

  constructor(
    firebaseClient: LoggedDatabaseClient,
    vectorService: ThemesVectorService,
    wordDataset: ThemesWordDataset
  ) {
    this.firebaseClient = firebaseClient;
    this.vectorService = vectorService;
    this.wordDataset = wordDataset;
  }

  /**
   * Generate a complete puzzle for a specific date and difficulty
   */
  async generatePuzzle(options: PuzzleGenerationOptions): Promise<ThemesPuzzle | null> {
    logger.info(`Generating puzzle: ${options.date}, #${options.puzzleNumber}, ${options.gridSize}x${options.gridSize}`);

    try {
      // Validate inputs
      if (!isValidPuzzleSize(options.gridSize)) {
        throw new Error(`Invalid puzzle size: ${options.gridSize}`);
      }

      const categoriesNeeded = options.gridSize;
      const wordsPerCategory = options.gridSize;

      // Generate categories using vector similarity
      const categories = await this.generateCategories(categoriesNeeded, wordsPerCategory, options);
      
      if (categories.length < categoriesNeeded) {
        logger.error(`Failed to generate enough categories: ${categories.length}/${categoriesNeeded}`);
        return null;
      }

      // Collect all words and shuffle them
      const allWords: string[] = [];
      categories.forEach(category => {
        allWords.push(...category.words);
      });

      const shuffledWords = this.shuffleArray(allWords);

      // Calculate average difficulty
      const difficulty = this.calculatePuzzleDifficulty(categories, options.gridSize);

      // Create puzzle object
      const puzzle: ThemesPuzzle = {
        id: generatePuzzleId(options.date, options.puzzleNumber),
        date: options.date,
        gridSize: options.gridSize,
        puzzleNumber: options.puzzleNumber,
        words: shuffledWords,
        categories: categories,
        difficulty: difficulty,
        createdAt: Date.now()
      };

      // Store puzzle in database
      await this.storePuzzle(puzzle);

      logger.info(`Successfully generated puzzle: ${puzzle.id}`);
      return puzzle;
    } catch (error) {
      logger.error(`Failed to generate puzzle:`, error);
      return null;
    }
  }

  /**
   * Generate all puzzles for a specific date (1-7 puzzles of increasing difficulty)
   */
  async generateDailyPuzzles(date: string): Promise<ThemesPuzzle[]> {
    logger.info(`Generating all daily puzzles for ${date}`);

    const puzzles: ThemesPuzzle[] = [];
    
    for (let i = 0; i < THEMES_CONFIG.DAILY_PUZZLE_COUNT; i++) {
      const puzzleNumber = i + 1;
      const gridSize = THEMES_CONFIG.PUZZLE_SIZES[i];

      try {
        const puzzle = await this.generatePuzzle({
          date,
          puzzleNumber,
          gridSize,
          minSimilarity: THEMES_CONFIG.MIN_CATEGORY_SIMILARITY,
          maxCrossSimilarity: THEMES_CONFIG.MAX_CROSS_CATEGORY_SIMILARITY
        });

        if (puzzle) {
          puzzles.push(puzzle);
          logger.info(`Generated puzzle ${puzzleNumber}/7: ${gridSize}x${gridSize}`);
        } else {
          logger.error(`Failed to generate puzzle ${puzzleNumber}/7`);
        }

        // Small delay between puzzle generations
        await this.sleep(500);
      } catch (error) {
        logger.error(`Error generating puzzle ${puzzleNumber}:`, error);
      }
    }

    logger.info(`Generated ${puzzles.length}/${THEMES_CONFIG.DAILY_PUZZLE_COUNT} puzzles for ${date}`);
    return puzzles;
  }

  /**
   * Generate themed categories using vector similarity
   */
  private async generateCategories(
    categoriesNeeded: number,
    wordsPerCategory: number,
    options: PuzzleGenerationOptions
  ): Promise<ThemesCategory[]> {
    const maxAttempts = categoriesNeeded * 3; // Try 3x more theme words than needed
    const categories: ThemesCategory[] = [];
    const usedWords = new Set<string>();

    // Get candidate theme words
    const candidateThemeWords = await this.wordDataset.getRandomWords(maxAttempts);
    
    logger.debug(`Got ${candidateThemeWords.length} candidate theme words`);

    for (const themeWord of candidateThemeWords) {
      if (categories.length >= categoriesNeeded) {
        break;
      }

      if (usedWords.has(themeWord)) {
        continue;
      }

      try {
        // Find similar words for this theme
        const similarWords = await this.vectorService.findSimilarWords(
          themeWord, 
          wordsPerCategory * 2 // Get extra words for filtering
        );

        if (similarWords.length < wordsPerCategory - 1) {
          logger.debug(`Not enough similar words for theme: ${themeWord} (${similarWords.length})`);
          continue;
        }

        // Filter out already used words
        const availableWords = similarWords.filter(
          result => !usedWords.has(result.word) && result.word !== themeWord
        );

        if (availableWords.length < wordsPerCategory - 1) {
          logger.debug(`Not enough unused similar words for theme: ${themeWord}`);
          continue;
        }

        // Select best words for this category
        const selectedWords = availableWords
          .slice(0, wordsPerCategory - 1)
          .map(result => result.word);

        // Add theme word itself
        const categoryWords = [themeWord, ...selectedWords];

        // Calculate average similarity
        const averageSimilarity = availableWords
          .slice(0, wordsPerCategory - 1)
          .reduce((sum, result) => sum + result.similarity, 0) / (wordsPerCategory - 1);

        // Check if similarity meets requirements
        const minSimilarity = options.minSimilarity || THEMES_CONFIG.MIN_CATEGORY_SIMILARITY;
        if (averageSimilarity < minSimilarity) {
          logger.debug(`Category similarity too low: ${themeWord} (${averageSimilarity.toFixed(3)})`);
          continue;
        }

        // Check for conflicts with existing categories
        if (this.hasConflictWithExistingCategories(categoryWords, categories, options)) {
          logger.debug(`Category conflicts with existing: ${themeWord}`);
          continue;
        }

        // Create category
        const category: ThemesCategory = {
          themeWord: themeWord,
          words: categoryWords,
          similarity: averageSimilarity
        };

        categories.push(category);
        
        // Mark all words as used
        categoryWords.forEach(word => usedWords.add(word));

        logger.debug(`Created category: ${themeWord} (similarity: ${averageSimilarity.toFixed(3)})`);
      } catch (error) {
        logger.error(`Error processing theme word ${themeWord}:`, error);
      }
    }

    return categories;
  }

  /**
   * Check if a category conflicts with existing categories
   */
  private hasConflictWithExistingCategories(
    candidateWords: string[],
    existingCategories: ThemesCategory[],
    options: PuzzleGenerationOptions
  ): boolean {
    const maxCrossSimilarity = options.maxCrossSimilarity || THEMES_CONFIG.MAX_CROSS_CATEGORY_SIMILARITY;

    for (const existingCategory of existingCategories) {
      // Check for word overlap
      const overlap = candidateWords.filter(word => 
        existingCategory.words.includes(word)
      );
      
      if (overlap.length > 0) {
        return true; // Direct word conflict
      }

      // Check semantic similarity between theme words
      // This would require computing similarity between theme words
      // For MVP, we'll skip this check and rely on word overlap
    }

    return false;
  }

  /**
   * Calculate puzzle difficulty based on categories and grid size
   */
  private calculatePuzzleDifficulty(categories: ThemesCategory[], gridSize: number): number {
    // Base difficulty from grid size
    let difficulty = gridSize; // 4-10 base difficulty

    // Adjust based on category similarities
    const avgSimilarity = categories.reduce((sum, cat) => sum + cat.similarity, 0) / categories.length;
    
    // Lower similarity = higher difficulty
    const similarityAdjustment = (1 - avgSimilarity) * 3; // 0-3 adjustment
    
    difficulty += similarityAdjustment;

    // Clamp to 1-10 scale
    return Math.max(1, Math.min(10, Math.round(difficulty)));
  }

  /**
   * Store puzzle in database
   */
  private async storePuzzle(puzzle: ThemesPuzzle): Promise<void> {
    try {
      const puzzlePath = THEMES_DB_PATHS.PUZZLE(puzzle.date, puzzle.id);
      await this.firebaseClient.setRawPath(puzzlePath, puzzle);
      
      logger.debug(`Stored puzzle: ${puzzle.id}`);
    } catch (error) {
      logger.error(`Failed to store puzzle ${puzzle.id}:`, error);
      throw error;
    }
  }

  /**
   * Get puzzle from database
   */
  async getPuzzle(date: string, puzzleId: string): Promise<ThemesPuzzle | null> {
    try {
      const puzzlePath = THEMES_DB_PATHS.PUZZLE(date, puzzleId);
      return await this.firebaseClient.getRawPath(puzzlePath);
    } catch (error) {
      logger.error(`Failed to get puzzle ${puzzleId}:`, error);
      return null;
    }
  }

  /**
   * Get all puzzles for a date
   */
  async getDailyPuzzles(date: string): Promise<ThemesPuzzle[]> {
    try {
      const dailyPath = THEMES_DB_PATHS.DAILY_PUZZLES(date);
      const dailyData = await this.firebaseClient.getRawPath(dailyPath);
      
      if (!dailyData) {
        return [];
      }

      // Extract puzzles from the daily data
      const puzzles: ThemesPuzzle[] = [];
      for (const [key, value] of Object.entries(dailyData)) {
        if (key.includes('puzzle_') && value && typeof value === 'object') {
          puzzles.push(value as ThemesPuzzle);
        }
      }

      // Sort by puzzle number
      puzzles.sort((a, b) => a.puzzleNumber - b.puzzleNumber);
      
      return puzzles;
    } catch (error) {
      logger.error(`Failed to get daily puzzles for ${date}:`, error);
      return [];
    }
  }

  /**
   * Validate puzzle quality
   */
  async validatePuzzle(puzzle: ThemesPuzzle): Promise<{
    valid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    // Check word count
    const expectedWords = puzzle.gridSize * puzzle.gridSize;
    if (puzzle.words.length !== expectedWords) {
      issues.push(`Word count mismatch: expected ${expectedWords}, got ${puzzle.words.length}`);
    }

    // Check category count
    if (puzzle.categories.length !== puzzle.gridSize) {
      issues.push(`Category count mismatch: expected ${puzzle.gridSize}, got ${puzzle.categories.length}`);
    }

    // Check for duplicate words
    const wordSet = new Set(puzzle.words);
    if (wordSet.size !== puzzle.words.length) {
      issues.push('Duplicate words found in puzzle');
    }

    // Check category word counts
    for (const category of puzzle.categories) {
      if (category.words.length !== puzzle.gridSize) {
        issues.push(`Category ${category.themeWord} has wrong word count: ${category.words.length}`);
      }
    }

    // Check that all category words are in the puzzle words
    const allCategoryWords = new Set<string>();
    puzzle.categories.forEach(cat => {
      cat.words.forEach(word => allCategoryWords.add(word));
    });

    for (const word of puzzle.words) {
      if (!allCategoryWords.has(word)) {
        issues.push(`Puzzle word ${word} not found in any category`);
      }
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Utility function to shuffle array
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Utility function for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}