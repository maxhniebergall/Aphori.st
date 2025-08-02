/**
 * Simple Themes Puzzle Generator
 * Uses KNN to create Connections-style puzzles
 */

import { ThemesKNNService } from './ThemesKNNService.js';
import { ThemesPuzzle, ThemeCategory } from '../../types/games/themes.js';
import logger from '../../logger.js';

export class SimpleThemesPuzzleGenerator {
  private knnService: ThemesKNNService;
  private puzzleCache: Map<string, ThemesPuzzle[]> = new Map(); // Cache puzzles by date

  constructor(knnService: ThemesKNNService) {
    this.knnService = knnService;
  }

  /**
   * Generate a 4x4 puzzle (4 categories, 4 words each)
   */
  async generatePuzzle(puzzleId: string): Promise<ThemesPuzzle | null> {
    try {
      const categories: ThemeCategory[] = [];
      const usedWords = new Set<string>();
      
      // Generate 4 categories
      for (let i = 0; i < 4; i++) {
        const category = await this.generateCategory(usedWords);
        if (!category) {
          logger.warn(`Failed to generate category ${i + 1}`);
          return null;
        }
        
        categories.push(category);
        category.words.forEach(word => usedWords.add(word));
      }

      // Collect all words
      const allWords = categories.flatMap(cat => cat.words);
      
      return {
        id: puzzleId,
        date: new Date().toISOString().split('T')[0],
        puzzleNumber: 1,
        gridSize: 4,
        difficulty: 'medium',
        categories,
        words: allWords
      };
    } catch (error) {
      logger.error('Failed to generate puzzle:', error);
      return null;
    }
  }

  /**
   * Generate a single category using KNN
   */
  private async generateCategory(usedWords: Set<string>): Promise<ThemeCategory | null> {
    const maxAttempts = 50;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Pick a random seed word that hasn't been used
      const seedWord = this.knnService.getRandomWord();
      if (usedWords.has(seedWord)) continue;
      
      // Find 4 similar words (not including the seed word)
      const neighbors = await this.knnService.findNearest(seedWord, 4);
      
      // Filter out used words
      const availableNeighbors = neighbors.filter(n => !usedWords.has(n.word));
      
      if (availableNeighbors.length >= 4) {
        // Use only the 4 neighbor words, not the seed word
        const words = availableNeighbors.slice(0, 4).map(n => n.word);
        
        return {
          id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          themeWord: seedWord, // The seed word becomes the theme/category name
          words, // Only the neighbors are in the puzzle
          difficulty: Math.round(Math.random() * 3) + 1, // 1-4
          similarity: Math.min(...availableNeighbors.slice(0, 4).map(n => n.similarity))
        };
      }
    }
    
    logger.warn('Could not generate category after max attempts');
    return null;
  }

  /**
   * Guess a theme name from words (simple heuristic)
   */
  private guessTheme(words: string[]): string {
    // Simple theme detection based on common patterns
    const themes: { [key: string]: string[] } = {
      'Animals': ['dog', 'cat', 'bird', 'fish', 'horse', 'cow', 'pig', 'sheep', 'lion', 'tiger', 'bear', 'wolf', 'fox', 'deer', 'rabbit', 'mouse', 'rat', 'duck', 'goose', 'chicken'],
      'Colors': ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white', 'gray', 'grey'],
      'Food': ['pizza', 'burger', 'sandwich', 'salad', 'soup', 'bread', 'cheese', 'meat', 'chicken', 'beef', 'pork', 'fish', 'apple', 'banana', 'orange'],
      'Sports': ['football', 'basketball', 'baseball', 'soccer', 'tennis', 'golf', 'hockey', 'swimming', 'running', 'boxing'],
      'Body Parts': ['head', 'hand', 'foot', 'arm', 'leg', 'eye', 'nose', 'mouth', 'ear', 'finger', 'toe'],
      'Transportation': ['car', 'bus', 'train', 'plane', 'boat', 'bike', 'bicycle', 'truck', 'motorcycle'],
      'Weather': ['rain', 'snow', 'sun', 'wind', 'storm', 'cloud', 'hot', 'cold', 'warm'],
      'Music': ['song', 'music', 'piano', 'guitar', 'drum', 'violin', 'band', 'singer'],
      'Technology': ['computer', 'phone', 'internet', 'software', 'website', 'email', 'digital']
    };
    
    // Count matches for each theme
    let bestTheme = 'Mystery';
    let bestScore = 0;
    
    for (const [themeName, themeWords] of Object.entries(themes)) {
      const matches = words.filter(word => 
        themeWords.some(themeWord => 
          word.includes(themeWord) || themeWord.includes(word)
        )
      ).length;
      
      if (matches > bestScore) {
        bestScore = matches;
        bestTheme = themeName;
      }
    }
    
    return bestTheme;
  }

  /**
   * Generate multiple puzzles for a date
   */
  async generateDailyPuzzles(date: string): Promise<ThemesPuzzle[]> {
    // Check cache first
    if (this.puzzleCache.has(date)) {
      logger.debug(`Returning cached puzzles for ${date}`);
      return this.puzzleCache.get(date)!;
    }

    const puzzles: ThemesPuzzle[] = [];
    
    // Generate 3 puzzles of different difficulties
    for (let i = 0; i < 3; i++) {
      const puzzleId = `themes_${date}_${i + 1}`;
      const puzzle = await this.generatePuzzle(puzzleId);
      
      if (puzzle) {
        puzzle.puzzleNumber = i + 1;
        puzzle.date = date;
        puzzles.push(puzzle);
      }
    }
    
    // Cache the generated puzzles
    this.puzzleCache.set(date, puzzles);
    
    logger.info(`Generated and cached ${puzzles.length} puzzles for ${date}`);
    return puzzles;
  }

  /**
   * Get a specific puzzle by date and puzzleId
   * For the game state route compatibility
   */
  async getPuzzle(date: string, puzzleId: string): Promise<ThemesPuzzle | null> {
    try {
      // Generate puzzles for the date and find the matching one
      const puzzles = await this.generateDailyPuzzles(date);
      return puzzles.find(p => p.id === puzzleId) || null;
    } catch (error) {
      logger.error('Failed to get puzzle:', error);
      return null;
    }
  }
}