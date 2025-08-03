/**
 * Themes Word Dataset Manager
 * Handles loading, processing, and managing word datasets for the themes game
 */

import { LoggedDatabaseClient } from '../../db/LoggedDatabaseClient.js';
import { ThemesVectorService } from './ThemesVectorService.js';
import { ThemesQualityControl } from './ThemesQualityControl.js';
import { THEMES_DB_PATHS, WordQualityMetrics } from '../../types/games/themes.js';
import logger from '../../logger.js';

export interface WordDatasetEntry {
  word: string;
  frequency?: number;
  difficulty?: number;
  categories?: string[];
  validated: boolean;
}

export interface WordDatasetMetadata {
  totalWords: number;
  lastUpdated: number;
  version: string;
  source: string;
}

export class ThemesWordDataset {
  private firebaseClient: LoggedDatabaseClient;
  private vectorService: ThemesVectorService;
  private qualityControl: ThemesQualityControl;

  constructor(firebaseClient: LoggedDatabaseClient, vectorService: ThemesVectorService) {
    this.firebaseClient = firebaseClient;
    this.vectorService = vectorService;
    this.qualityControl = new ThemesQualityControl(vectorService);
  }

  /**
   * Load initial word dataset from external vector files
   */
  async initializeDataset(force: boolean = false): Promise<void> {
    logger.info('Initializing themes word dataset...');

    try {
      const existingMetadata = await this.getDatasetMetadata();
      if (existingMetadata && existingMetadata.totalWords > 0 && !force) {
        const currentVersion = existingMetadata.version || '1.0.0-mvp';
        const targetVersion = '2.0.0-vectors';
        
        if (currentVersion === targetVersion) {
          logger.info(`Dataset already exists with ${existingMetadata.totalWords} words (version ${currentVersion})`);
          return;
        } else {
          logger.info(`Dataset version upgrade needed: ${currentVersion} -> ${targetVersion}`);
          force = true;
        }
      }

      if (force) {
        logger.info('Clearing existing dataset for reload...');
        await this.clearDataset();
      }

      // Load words from the new vector vocabulary file
      const vocabularyWords = await this.loadWordsFromVectorVocab();
      
      logger.info(`Loading ${vocabularyWords.length} words from vector vocabulary...`);
      // Skip vector index since it's already loaded from binary files
      const result = await this.addWordsToDataset(vocabularyWords, true);
      
      // Update metadata
      const metadata: WordDatasetMetadata = {
        totalWords: result.added,
        lastUpdated: Date.now(),
        version: '2.0.0-vectors',
        source: 'vector-vocabulary'
      };
      
      await this.firebaseClient.setRawPath(THEMES_DB_PATHS.WORD_DATASET_METADATA, metadata);
      
      logger.info(`Dataset initialized: ${result.added} words added, ${result.failed} failed`);
    } catch (error) {
      logger.error('Failed to initialize word dataset:', error);
      throw error;
    }
  }

  /**
   * Add words to the dataset (and optionally vector index)
   */
  async addWordsToDataset(words: string[], skipVectorIndex: boolean = false): Promise<{ added: number; failed: number }> {
    let added = 0;
    let failed = 0;

    // Process words in batches to avoid overwhelming the system
    const batchSize = 50;
    const batches = this.chunkArray(words, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} words)`);

      for (const word of batch) {
        try {
          const processedWord = this.preprocessWord(word);
          if (!processedWord || !this.validateWord(processedWord)) {
            failed++;
            continue;
          }

          // Quality validation using quality control service
          const qualityValidation = await this.qualityControl.validateWord(processedWord);
          if (!qualityValidation.valid || qualityValidation.score < 0.5) {
            logger.debug(`Word failed quality validation: ${processedWord} (score: ${qualityValidation.score.toFixed(2)})`);
            failed++;
            continue;
          }

          // Add to vector index only if not skipping and not already loaded
          if (!skipVectorIndex) {
            const vectorSuccess = await this.vectorService.addWord(processedWord);
            if (!vectorSuccess) {
              logger.warn(`Failed to add word to vector index: ${processedWord}`);
              failed++;
              continue;
            }
          }

          // Store in dataset with quality metrics
          const wordMetrics = qualityValidation.metrics as WordQualityMetrics;
          const wordEntry: WordDatasetEntry = {
            word: processedWord,
            validated: true,
            frequency: wordMetrics.commonality,
            difficulty: wordMetrics.difficulty
          };

          await this.storeWordEntry(processedWord, wordEntry);
          added++;

        } catch (error) {
          logger.error(`Failed to process word ${word}:`, error);
          failed++;
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i < batches.length - 1) {
        await this.sleep(100);
      }
    }

    return { added, failed };
  }

  /**
   * Load words from the binary theme index vocabulary
   */
  private async loadWordsFromVectorVocab(): Promise<string[]> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Path to the binary theme index vocabulary
      const indexDir = path.resolve(process.cwd(), 'scripts/datascience/themes_index');
      const vocabPath = path.join(indexDir, 'themes_vocabulary.json');
      
      if (!fs.existsSync(vocabPath)) {
        logger.warn('Binary theme vocabulary file not found, falling back to curated list');
        return this.getCuratedWordList();
      }

      const vocabData = fs.readFileSync(vocabPath, 'utf8');
      const words = JSON.parse(vocabData) as string[];
      
      // Words from binary index are already filtered, but limit for performance
      const maxWords = 10000; // Increase limit since they're already filtered
      const selectedWords = words.slice(0, maxWords);
      
      logger.info(`Loaded ${selectedWords.length} words from binary theme vocabulary (out of ${words.length} total)`);
      return selectedWords;
    } catch (error) {
      logger.error('Failed to load binary theme vocabulary:', error);
      logger.info('Falling back to curated word list');
      return this.getCuratedWordList();
    }
  }

  /**
   * Check if a word is suitable for themes game (basic filtering only)
   */
  private isWordSuitableForThemes(word: string): boolean {
    if (!word || typeof word !== 'string') return false;
    
    const cleaned = word.toLowerCase().trim();
    
    // Length requirements
    if (cleaned.length < 3 || cleaned.length > 15) return false;
    
    // Only letters (no numbers, punctuation, or special characters)
    if (!/^[a-z]+$/.test(cleaned)) return false;
    
    return true;
  }

  /**
   * Get curated word list for MVP (fallback)
   * This is a starter set of common, well-known words suitable for themes
   */
  private getCuratedWordList(): string[] {
    return [
      // Animals
      'cat', 'dog', 'bird', 'fish', 'horse', 'cow', 'pig', 'sheep', 'goat', 'chicken',
      'duck', 'turkey', 'rabbit', 'deer', 'bear', 'wolf', 'fox', 'lion', 'tiger', 'elephant',
      'giraffe', 'zebra', 'monkey', 'gorilla', 'chimpanzee', 'whale', 'dolphin', 'shark', 'octopus', 'crab',
      
      // Colors
      'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white',
      'gray', 'silver', 'gold', 'crimson', 'azure', 'emerald', 'amber', 'violet', 'indigo', 'turquoise',
      
      // Food
      'apple', 'banana', 'orange', 'grape', 'strawberry', 'cherry', 'peach', 'pear', 'lemon', 'lime',
      'bread', 'cheese', 'milk', 'butter', 'egg', 'meat', 'chicken', 'beef', 'pork', 'fish',
      'rice', 'pasta', 'pizza', 'sandwich', 'salad', 'soup', 'cake', 'cookie', 'chocolate', 'ice cream',
      
      // Transportation
      'car', 'bus', 'train', 'plane', 'bicycle', 'motorcycle', 'boat', 'ship', 'truck', 'taxi',
      'subway', 'helicopter', 'rocket', 'scooter', 'skateboard', 'roller', 'wagon', 'sled', 'canoe', 'yacht',
      
      // Weather
      'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'wind', 'storm', 'thunder', 'lightning',
      'fog', 'mist', 'hail', 'frost', 'ice', 'heat', 'cold', 'warm', 'cool', 'humid',
      
      // Body Parts
      'head', 'hair', 'eye', 'nose', 'mouth', 'ear', 'neck', 'shoulder', 'arm', 'hand',
      'finger', 'thumb', 'chest', 'back', 'stomach', 'leg', 'knee', 'foot', 'toe', 'heart',
      
      // Household Items
      'table', 'chair', 'bed', 'sofa', 'lamp', 'door', 'window', 'wall', 'floor', 'ceiling',
      'kitchen', 'bathroom', 'bedroom', 'living room', 'garage', 'garden', 'yard', 'fence', 'roof', 'chimney',
      
      // Tools
      'hammer', 'screwdriver', 'wrench', 'saw', 'drill', 'nail', 'screw', 'bolt', 'nut', 'washer',
      'knife', 'fork', 'spoon', 'plate', 'bowl', 'cup', 'glass', 'bottle', 'can', 'jar',
      
      // Sports
      'football', 'basketball', 'baseball', 'soccer', 'tennis', 'golf', 'hockey', 'swimming', 'running', 'jumping',
      'boxing', 'wrestling', 'skiing', 'skating', 'surfing', 'cycling', 'climbing', 'fishing', 'hunting', 'dancing',
      
      // Music
      'piano', 'guitar', 'drum', 'violin', 'trumpet', 'flute', 'saxophone', 'clarinet', 'harp', 'organ',
      'song', 'music', 'melody', 'rhythm', 'beat', 'note', 'chord', 'scale', 'harmony', 'symphony',
      
      // School/Education
      'school', 'teacher', 'student', 'book', 'pen', 'pencil', 'paper', 'desk', 'chair', 'board',
      'math', 'science', 'history', 'english', 'art', 'music', 'gym', 'library', 'classroom', 'homework',
      
      // Technology
      'computer', 'phone', 'television', 'radio', 'camera', 'video', 'internet', 'email', 'website', 'software',
      'hardware', 'keyboard', 'mouse', 'screen', 'monitor', 'printer', 'scanner', 'speaker', 'microphone', 'headphones',
      
      // Nature
      'tree', 'flower', 'grass', 'leaf', 'branch', 'root', 'seed', 'fruit', 'vegetable', 'plant',
      'mountain', 'hill', 'valley', 'river', 'lake', 'ocean', 'sea', 'beach', 'island', 'desert',
      'forest', 'jungle', 'field', 'meadow', 'pond', 'stream', 'waterfall', 'cave', 'rock', 'stone',
      
      // Emotions/Feelings
      'happy', 'sad', 'angry', 'excited', 'scared', 'surprised', 'confused', 'proud', 'ashamed', 'grateful',
      'love', 'hate', 'like', 'dislike', 'enjoy', 'prefer', 'want', 'need', 'hope', 'fear',
      
      // Actions/Verbs
      'walk', 'run', 'jump', 'sit', 'stand', 'lie', 'sleep', 'wake', 'eat', 'drink',
      'read', 'write', 'speak', 'listen', 'see', 'look', 'watch', 'hear', 'smell', 'taste',
      'touch', 'feel', 'think', 'know', 'understand', 'remember', 'forget', 'learn', 'teach', 'study'
    ];
  }

  /**
   * Preprocess a word (normalize, clean)
   */
  private preprocessWord(word: string): string | null {
    if (!word || typeof word !== 'string') {
      return null;
    }

    // Convert to lowercase and trim
    let processed = word.toLowerCase().trim();
    
    // Remove special characters, keep only letters
    processed = processed.replace(/[^a-z]/g, '');
    
    // Check length
    if (processed.length < 2 || processed.length > 20) {
      return null;
    }

    return processed;
  }

  /**
   * Validate a word for suitability in themes game
   */
  private validateWord(word: string): boolean {
    if (!word || word.length < 2) {
      return false;
    }

    // Filter out inappropriate or difficult words
    const excludeWords = new Set([
      'xxx', 'sex', 'porn', 'drug', 'kill', 'death', 'hate', 'racist', 'nazi'
      // Add more exclusions as needed
    ]);

    if (excludeWords.has(word.toLowerCase())) {
      return false;
    }

    // Only allow common dictionary words (basic validation)
    // In production, this could use a dictionary API
    return true;
  }

  /**
   * Estimate word frequency (simple heuristic)
   */
  private estimateWordFrequency(word: string): number {
    // Very basic frequency estimation based on word length and common patterns
    // In production, this could use actual frequency data
    const length = word.length;
    if (length <= 4) return 0.8; // Short words tend to be more common
    if (length <= 6) return 0.6;
    if (length <= 8) return 0.4;
    return 0.2; // Longer words tend to be less common
  }

  /**
   * Estimate word difficulty (1-10 scale)
   */
  private estimateWordDifficulty(word: string): number {
    // Simple difficulty estimation
    const length = word.length;
    if (length <= 4) return 2;
    if (length <= 6) return 4;
    if (length <= 8) return 6;
    return 8;
  }

  /**
   * Store word entry in database
   */
  private async storeWordEntry(word: string, entry: WordDatasetEntry): Promise<void> {
    const wordPath = `${THEMES_DB_PATHS.WORD_DATASET}/${word}`;
    await this.firebaseClient.setRawPath(wordPath, entry);
  }

  /**
   * Get dataset metadata
   */
  private async getDatasetMetadata(): Promise<WordDatasetMetadata | null> {
    try {
      return await this.firebaseClient.getRawPath(THEMES_DB_PATHS.WORD_DATASET_METADATA);
    } catch (error) {
      logger.error('Failed to get dataset metadata:', error);
      return null;
    }
  }

  /**
   * Get random words from dataset
   */
  async getRandomWords(count: number): Promise<string[]> {
    try {
      const datasetPath = THEMES_DB_PATHS.WORD_DATASET;
      const dataset = await this.firebaseClient.getRawPath(datasetPath);
      
      if (!dataset) {
        logger.warn('No word dataset found');
        return [];
      }

      const allWords = Object.keys(dataset).filter(key => key !== 'metadata');
      
      // Shuffle and return requested count
      const shuffled = this.shuffleArray([...allWords]);
      return shuffled.slice(0, count);
    } catch (error) {
      logger.error('Failed to get random words:', error);
      return [];
    }
  }

  /**
   * Get quality-filtered random words from dataset
   */
  async getQualityRandomWords(count: number, minQualityScore: number = 0.6): Promise<string[]> {
    try {
      const datasetPath = THEMES_DB_PATHS.WORD_DATASET;
      const dataset = await this.firebaseClient.getRawPath(datasetPath);
      
      if (!dataset) {
        logger.warn('No word dataset found');
        return [];
      }

      // Get words with quality filtering
      const allWords = Object.keys(dataset).filter(key => key !== 'metadata');
      const qualityWords: string[] = [];

      // Filter words by stored quality metrics or validate on-the-fly
      for (const word of allWords) {
        const entry = dataset[word] as WordDatasetEntry;
        
        // If we have stored frequency/difficulty, use simple heuristic
        if (entry.frequency !== undefined && entry.difficulty !== undefined) {
          const simpleQuality = (entry.frequency + (10 - entry.difficulty) / 9) / 2;
          if (simpleQuality >= minQualityScore) {
            qualityWords.push(word);
          }
        } else {
          // Fallback to basic validation
          if (this.validateWord(word)) {
            qualityWords.push(word);
          }
        }

        // Stop when we have enough candidates
        if (qualityWords.length >= count * 2) {
          break;
        }
      }
      
      // Shuffle and return requested count
      const shuffled = this.shuffleArray(qualityWords);
      return shuffled.slice(0, Math.min(count, shuffled.length));
    } catch (error) {
      logger.error('Failed to get quality random words:', error);
      return [];
    }
  }

  /**
   * Get dataset statistics
   */
  async getDatasetStats(): Promise<{
    totalWords: number;
    averageDifficulty: number;
    wordLengthDistribution: Record<number, number>;
  }> {
    try {
      const metadata = await this.getDatasetMetadata();
      const datasetPath = THEMES_DB_PATHS.WORD_DATASET;
      const dataset = await this.firebaseClient.getRawPath(datasetPath);

      if (!dataset) {
        return { totalWords: 0, averageDifficulty: 0, wordLengthDistribution: {} };
      }

      const words = Object.keys(dataset).filter(key => key !== 'metadata');
      const lengthDistribution: Record<number, number> = {};
      let totalDifficulty = 0;

      for (const word of words) {
        const length = word.length;
        lengthDistribution[length] = (lengthDistribution[length] || 0) + 1;
        
        const entry = dataset[word] as WordDatasetEntry;
        totalDifficulty += entry.difficulty || 5;
      }

      return {
        totalWords: words.length,
        averageDifficulty: words.length > 0 ? totalDifficulty / words.length : 0,
        wordLengthDistribution: lengthDistribution
      };
    } catch (error) {
      logger.error('Failed to get dataset stats:', error);
      return { totalWords: 0, averageDifficulty: 0, wordLengthDistribution: {} };
    }
  }

  /**
   * Utility function to chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
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

  /**
   * Clear the entire word dataset
   */
  async clearDataset(): Promise<void> {
    try {
      logger.warn('Clearing word dataset...');
      await this.firebaseClient.removeRawPath(THEMES_DB_PATHS.WORD_DATASET);
      await this.firebaseClient.removeRawPath(THEMES_DB_PATHS.WORD_DATASET_METADATA);
      logger.info('Word dataset cleared');
    } catch (error) {
      logger.error('Failed to clear word dataset:', error);
      throw error;
    }
  }
}