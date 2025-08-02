/**
 * Simple Themes Word Dataset
 * Just loads words from binary index - no database, no complex management
 */

import logger from '../../logger.js';

export class SimpleThemesWordDataset {
  private words: string[] = [];
  private initialized: boolean = false;

  constructor() {
    // No dependencies - completely self-contained
  }

  /**
   * Initialize from binary index vocabulary
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('SimpleThemesWordDataset already initialized');
      return;
    }

    logger.info('Initializing Simple Themes Word Dataset...');
    
    try {
      await this.loadFromBinaryIndex();
      this.initialized = true;
      logger.info(`SimpleThemesWordDataset initialized with ${this.words.length} words`);
    } catch (error) {
      logger.error('Failed to initialize SimpleThemesWordDataset:', error);
      throw new Error('Failed to initialize simple themes word dataset');
    }
  }

  /**
   * Load words from binary index vocabulary
   */
  private async loadFromBinaryIndex(): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const indexDir = path.resolve(process.cwd(), 'scripts/datascience/themes_index');
      const vocabPath = path.join(indexDir, 'themes_vocabulary.json');
      
      if (!fs.existsSync(vocabPath)) {
        throw new Error('Binary theme vocabulary file not found');
      }

      logger.info('Loading words from binary index vocabulary...');
      
      const vocabData = fs.readFileSync(vocabPath, 'utf8');
      const vocabulary = JSON.parse(vocabData) as string[];
      
      // Take a reasonable subset for performance
      const maxWords = 50000; // Much larger than before since no database operations
      this.words = vocabulary.slice(0, maxWords);
      
      logger.info(`Loaded ${this.words.length} words from binary vocabulary (out of ${vocabulary.length} total)`);
    } catch (error) {
      logger.error('Failed to load from binary index vocabulary:', error);
      throw error;
    }
  }

  /**
   * Get random words from the dataset
   */
  async getRandomWords(count: number): Promise<string[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.words.length === 0) {
      logger.warn('No words available in dataset');
      return [];
    }

    // Shuffle and return requested count
    const shuffled = [...this.words];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled.slice(0, count);
  }

  /**
   * Get all words (for testing)
   */
  getAllWords(): string[] {
    return [...this.words];
  }

  /**
   * Get dataset statistics
   */
  getStats(): {
    totalWords: number;
    averageLength: number;
    lengthDistribution: Record<number, number>;
  } {
    if (this.words.length === 0) {
      return {
        totalWords: 0,
        averageLength: 0,
        lengthDistribution: {}
      };
    }

    const lengthDistribution: Record<number, number> = {};
    let totalLength = 0;

    for (const word of this.words) {
      const length = word.length;
      lengthDistribution[length] = (lengthDistribution[length] || 0) + 1;
      totalLength += length;
    }

    return {
      totalWords: this.words.length,
      averageLength: totalLength / this.words.length,
      lengthDistribution
    };
  }

  /**
   * Check if word exists in dataset
   */
  hasWord(word: string): boolean {
    return this.words.includes(word.toLowerCase());
  }

  /**
   * Get words by length
   */
  getWordsByLength(minLength: number, maxLength: number, count: number): string[] {
    const filtered = this.words.filter(word => 
      word.length >= minLength && word.length <= maxLength
    );
    
    // Shuffle and return requested count
    const shuffled = [...filtered];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled.slice(0, count);
  }
}