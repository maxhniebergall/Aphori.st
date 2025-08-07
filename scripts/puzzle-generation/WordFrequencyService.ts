/**
 * Word Frequency Service
 * Manages word frequency data from unigram frequency dataset for intelligent word selection
 */

// Simple console logger for standalone scripts
const logger = {
  info: console.log,
  debug: console.debug,
  warn: console.warn,
  error: console.error
};

export interface WordFrequencyEntry {
  word: string;
  count: number;
  frequency: number; // Raw frequency count (same as count)
}

export interface FrequencyStats {
  totalWords: number;
  minCount: number;
  maxCount: number;
  medianCount: number;
}

export class WordFrequencyService {
  private frequencyMap: Map<string, WordFrequencyEntry> = new Map();
  private sortedWords: string[] = [];
  private eligibleWordsCache: Map<number, string[]> = new Map(); // Cache for threshold -> eligible words
  private stats: FrequencyStats | null = null;
  private initialized = false;

  constructor() {}

  /**
   * Initialize the service by loading frequency data from CSV
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      logger.info('Loading word frequency data from unigram_freq.csv...');
      
      const fs = await import('fs');
      const path = await import('path');
      
      // Look for CSV file in multiple possible locations (prefer lemmatized version)
      const possibleBasePaths = [
        path.resolve(process.cwd(), 'scripts/datascience/themes_quality/data'),
        path.resolve(process.cwd(), '..', 'scripts/datascience/themes_quality/data'),
        path.resolve(process.cwd(), '..', '..', 'scripts/datascience/themes_quality/data'),
      ];
      
      // Try lemmatized version first, fallback to original
      const possiblePaths: string[] = [];
      for (const basePath of possibleBasePaths) {
        possiblePaths.push(path.join(basePath, 'unigram_freq_lemmatized.csv')); // Preferred lemmatized version
        possiblePaths.push(path.join(basePath, 'unigram_freq.csv')); // Fallback original
      }
      
      let csvPath: string | null = null;
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          csvPath = testPath;
          break;
        }
      }
      
      if (!csvPath) {
        const pathsStr = possiblePaths.join('\n  - ');
        throw new Error(`Frequency data file not found. Tried:\n  - ${pathsStr}`);
      }
      
      const isLemmatized = csvPath.includes('lemmatized');
      logger.info(`Found frequency data at: ${csvPath} ${isLemmatized ? '(lemmatized)' : '(original)'}`);

      const csvContent = fs.readFileSync(csvPath, 'utf8');
      const lines = csvContent.split('\n');
      
      // Skip header line
      const dataLines = lines.slice(1).filter(line => line.trim());
      
      const entries: WordFrequencyEntry[] = [];
      let maxCount = 0;
      let minCount = Number.MAX_SAFE_INTEGER;

      // Parse CSV data (lemmatized data is already processed, no need for real-time lemmatization)
      for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i];
        try {
          const [word, countStr] = line.split(',');
          if (!word || !countStr) continue;
          
          const count = parseInt(countStr, 10);
          if (isNaN(count) || count <= 0) continue;
          
          // For lemmatized data, words are already processed and filtered
          // For original data, apply filtering
          const cleanWord = word.toLowerCase().trim();
          if (!this.isWordSuitableForThemes(cleanWord)) continue;
          
          entries.push({
            word: cleanWord,
            count,
            frequency: 0 // Will be calculated after we know min/max
          });
          
          maxCount = Math.max(maxCount, count);
          minCount = Math.min(minCount, count);
        } catch (error) {
          logger.debug(`Error parsing line ${i + 1}: ${line}`, error);
          continue;
        }
      }

      if (entries.length === 0) {
        throw new Error('No suitable words found in frequency dataset');
      }

      const originalWordCount = dataLines.length;
      const suitableWordCount = entries.length;
      logger.info(`Found ${suitableWordCount} suitable theme words from ${originalWordCount} total entries`);
      if (isLemmatized) {
        logger.info(`📝 Using pre-lemmatized dataset (canonical word forms)`);
      }

      // Use raw frequency counts directly (no normalization)
      for (const entry of entries) {
        // Keep the raw count as the frequency score
        entry.frequency = entry.count;
        this.frequencyMap.set(entry.word, entry);
      }

      // Sort words by frequency (most common first)
      this.sortedWords = entries
        .sort((a, b) => b.frequency - a.frequency)
        .map(entry => entry.word);

      // Calculate statistics
      const counts = entries.map(e => e.count).sort((a, b) => a - b);
      this.stats = {
        totalWords: entries.length,
        minCount,
        maxCount,
        medianCount: counts[Math.floor(counts.length / 2)]
      };

      this.initialized = true;
      logger.info(`Loaded ${entries.length} words with frequency data (range: ${minCount} to ${maxCount})`);
      
    } catch (error) {
      logger.error('Failed to initialize word frequency service:', error);
      throw error;
    }
  }

  /**
   * Get frequency data for a word
   */
  getWordFrequency(word: string): WordFrequencyEntry | null {
    this.ensureInitialized();
    return this.frequencyMap.get(word.toLowerCase()) || null;
  }

  /**
   * Get normalized frequency score (0-1) for a word
   */
  getFrequencyScore(word: string): number {
    const entry = this.getWordFrequency(word);
    return entry ? entry.frequency : 0;
  }

  /**
   * Check if word frequency data is available for a word
   */
  hasWord(word: string): boolean {
    this.ensureInitialized();
    return this.frequencyMap.has(word.toLowerCase());
  }

  /**
   * Get words within a specific frequency range
   * @param minFreq Minimum frequency (0-1)
   * @param maxFreq Maximum frequency (0-1)
   * @param limit Max number of words to return
   */
  getWordsInFrequencyRange(minFreq: number, maxFreq: number, limit: number = 1000): string[] {
    this.ensureInitialized();
    
    return this.sortedWords.filter(word => {
      const entry = this.frequencyMap.get(word);
      if (!entry) return false;
      return entry.frequency >= minFreq && entry.frequency <= maxFreq;
    }).slice(0, limit);
  }

  /**
   * Get randomly selected words weighted by frequency
   * Avoids very common words (top 1%) and very rare words (bottom 30%)
   */
  getFrequencyWeightedWords(count: number, avoidTopPercent: number = 0.01, avoidBottomPercent: number = 0.30): string[] {
    this.ensureInitialized();
    
    const totalWords = this.sortedWords.length;
    const skipTop = Math.floor(totalWords * avoidTopPercent);
    const skipBottom = Math.floor(totalWords * avoidBottomPercent);
    
    // Get words in the "sweet spot" - not too common, not too rare
    const candidateWords = this.sortedWords.slice(skipTop, totalWords - skipBottom);
    
    if (candidateWords.length === 0) {
      logger.warn('No candidate words in frequency range, falling back to middle range');
      const midStart = Math.floor(totalWords * 0.1);
      const midEnd = Math.floor(totalWords * 0.9);
      return this.sortedWords.slice(midStart, midEnd).slice(0, count);
    }

    // Weighted random selection - higher frequency words more likely to be selected
    const selectedWords: string[] = [];
    const used = new Set<string>();

    for (let i = 0; i < count && selectedWords.length < candidateWords.length; i++) {
      let word: string;
      let attempts = 0;
      
      do {
        // Use weighted selection - words earlier in the list (higher frequency) more likely
        const weightedIndex = Math.floor(Math.random() * candidateWords.length * Math.random());
        word = candidateWords[Math.min(weightedIndex, candidateWords.length - 1)];
        attempts++;
      } while (used.has(word) && attempts < 50);
      
      if (!used.has(word)) {
        selectedWords.push(word);
        used.add(word);
      }
    }

    return selectedWords;
  }

  /**
   * Get theme words (seed words for vector similarity search) from the [0.015%, 20%] frequency range
   * These are moderately common words suitable for puzzle themes
   */
  getThemeWords(count: number): string[] {
    return this.getWordsInFrequencyRange(0.00015, 0.20, count);
  }

  /**
   * Get category words (actual puzzle words) from the [0.015%, 30%] frequency range  
   * These include theme words plus some more common/rare words for variety
   */
  getCategoryWords(count: number): string[] {
    return this.getWordsInFrequencyRange(0.00015, 0.30, count);
  }

  /**
   * Get general puzzle words from a broader [0.001%, 40%] frequency range
   * For when you need a wider variety of words including more common/rare options
   */
  getPuzzleWords(count: number): string[] {
    return this.getWordsInFrequencyRange(0.00001, 0.40, count);
  }

  // Legacy method names for backward compatibility (deprecated)
  /**
   * @deprecated Use getThemeWords() instead
   */
  getSeedWords(count: number): string[] {
    return this.getThemeWords(count);
  }

  /**
   * Get statistics about the frequency dataset
   */
  getStats(): FrequencyStats | null {
    this.ensureInitialized();
    return this.stats;
  }

  /**
   * Check if a word is suitable for themes game
   */
  private isWordSuitableForThemes(word: string): boolean {
    if (!word || typeof word !== 'string') return false;
    
    const cleaned = word.toLowerCase().trim();
    
    // Length requirements
    if (cleaned.length < 3 || cleaned.length > 15) return false;
    
    // Only letters (no numbers, punctuation, or special characters)
    if (!/^[a-z]+$/.test(cleaned)) return false;
    
    // Exclude inappropriate words
    const excludeWords = new Set([
      'sex', 'porn', 'nude', 'naked', 'xxx', 'gay', 'lesbian', 'anal', 'oral', 'pussy', 'cum',
      'rape', 'incest', 'fuck', 'fucking', 'shit', 'ass', 'milf', 'mature', 'hardcore',
      'drug', 'kill', 'death', 'hate', 'racist', 'nazi', 'dead'
    ]);
    
    if (excludeWords.has(cleaned)) return false;
    
    // Exclude very technical terms, abbreviations, and non-dictionary words
    if (cleaned.length <= 3 && /^[a-z]{1,3}$/.test(cleaned)) {
      // Allow common short words but exclude technical abbreviations
      const allowedShort = new Set(['the', 'and', 'you', 'are', 'for', 'can', 'not', 'but', 'all', 'get', 'has', 'had', 'him', 'her', 'how', 'man', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'car', 'day', 'eye', 'far', 'got', 'run', 'sat', 'sun', 'top', 'try', 'win', 'yes', 'yet', 'ago', 'air', 'ask', 'bad', 'bag', 'bar', 'bed', 'big', 'bit', 'box', 'boy', 'bus', 'buy', 'car', 'cat', 'cup', 'cut', 'die', 'dog', 'eat', 'end', 'eye', 'far', 'few', 'fit', 'fly', 'fun', 'gas', 'god', 'got', 'gun', 'guy', 'hit', 'hot', 'ice', 'job', 'key', 'kid', 'law', 'lay', 'leg', 'let', 'lie', 'lot', 'low', 'man', 'map', 'may', 'mom', 'net', 'new', 'nor', 'not', 'now', 'odd', 'off', 'oil', 'old', 'one', 'our', 'out', 'own', 'pay', 'per', 'put', 'raw', 'red', 'run', 'sad', 'sat', 'say', 'sea', 'see', 'set', 'she', 'sit', 'six', 'sky', 'son', 'sun', 'tax', 'ten', 'the', 'tie', 'tip', 'too', 'top', 'try', 'two', 'use', 'van', 'war', 'was', 'way', 'web', 'who', 'why', 'win', 'won', 'yes', 'yet', 'you', 'zoo']);
      return allowedShort.has(cleaned);
    }
    
    return true;
  }

  /**
   * Get count of words that meet the frequency threshold
   * @param frequencyThreshold Minimum frequency score (0-1)
   * @returns Number of words meeting the threshold
   */
  getWordCountAboveThreshold(frequencyThreshold: number): number {
    this.ensureInitialized();
    
    // Check cache first
    if (!this.eligibleWordsCache.has(frequencyThreshold)) {
      // Filter and cache eligible words for this threshold
      const eligibleWords = this.sortedWords.filter(word => {
        const entry = this.frequencyMap.get(word);
        return entry && entry.frequency >= frequencyThreshold && this.isWordSuitableForThemes(word);
      });
      this.eligibleWordsCache.set(frequencyThreshold, eligibleWords);
    }
    
    const eligibleWords = this.eligibleWordsCache.get(frequencyThreshold)!;
    return eligibleWords.length;
  }

  /**
   * Get a random word that meets the frequency threshold
   * Uses memoized cache for efficiency across multiple calls
   * @param frequencyThreshold Minimum frequency score (0-1)
   * @returns Random word meeting threshold, or null if none found
   */
  getRandomWordAboveThreshold(frequencyThreshold: number): string | null {
    this.ensureInitialized();
    
    // Check cache first
    if (!this.eligibleWordsCache.has(frequencyThreshold)) {
      // Filter and cache eligible words for this threshold
      const eligibleWords = this.sortedWords.filter(word => {
        const entry = this.frequencyMap.get(word);
        return entry && entry.frequency >= frequencyThreshold && this.isWordSuitableForThemes(word);
      });
      this.eligibleWordsCache.set(frequencyThreshold, eligibleWords);
    }
    
    const eligibleWords = this.eligibleWordsCache.get(frequencyThreshold)!;
    
    if (eligibleWords.length === 0) {
      return null; // No words meet the threshold
    }
    
    // Return a random word from cached eligible words
    const randomIndex = Math.floor(Math.random() * eligibleWords.length);
    return eligibleWords[randomIndex];
  }

  /**
   * Ensure service is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('WordFrequencyService not initialized. Call initialize() first.');
    }
  }
}