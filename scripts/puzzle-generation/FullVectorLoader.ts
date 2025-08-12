/**
 * Full Vector Loader - Access to complete 2.9M word vector index
 * Standalone implementation for offline puzzle generation
 */

import fs from 'fs';
import path from 'path';
import faiss from 'faiss-node';
import { WordFrequencyService } from './WordFrequencyService.js';
import { UsedThemeWords } from './UsedThemeWords.js';
import { SpellCheckService } from './SpellCheckService.js';

export interface SearchResult {
  word: string;
  similarity: number;
}

export interface VectorLoadResult {
  totalWords: number;
  loadedWords: number;
  dimension: number;
  success: boolean;
}

export class FullVectorLoader {
  private faissIndex: faiss.IndexFlatIP | null = null;
  private fullVocabulary: string[] = [];
  private wordToIndex: Map<string, number> = new Map();
  private indexToWord: Map<number, string> = new Map();
  private vectorCache: Map<number, number[]> = new Map(); // Cache for vector data
  private initialized: boolean = false;
  private frequencyService: WordFrequencyService | null = null;
  private usedThemeWords!: UsedThemeWords; // Initialized in initialize() method
  private spellCheckService: SpellCheckService | null = null;

  /**
   * Initialize the full vector loader with complete 2.9M word dataset
   */
  async initialize(): Promise<VectorLoadResult> {
    if (this.initialized) {
      console.log('FullVectorLoader already initialized');
      return {
        totalWords: this.fullVocabulary.length,
        loadedWords: this.faissIndex?.ntotal() || 0,
        dimension: 300,
        success: true
      };
    }

    console.log('🚀 Loading full 2.9M word vector index...');
    
    // Initialize used theme words tracker
    this.usedThemeWords = new UsedThemeWords();
    
    try {
      // First try to load from themes_index (filtered index)
      const themesLoadResult = await this.loadFromThemesIndex();
      if (themesLoadResult.success) {
        this.initialized = true;
        
        // Initialize frequency service for better word selection
        try {
          this.frequencyService = new WordFrequencyService();
          await this.frequencyService.initialize();
          console.log(`✅ Frequency service initialized`);
        } catch (error) {
          console.warn('⚠️ Failed to initialize frequency service, falling back to random selection:', error);
        }

        // Initialize spell check service for quality controls
        try {
          this.spellCheckService = new SpellCheckService();
          await this.spellCheckService.initialize();
          console.log(`✅ Spell check service initialized`);
        } catch (error) {
          console.warn('⚠️ Failed to initialize spell check service, falling back to substring checking:', error);
        }
        
        console.log(`✅ Loaded ${themesLoadResult.loadedWords} words from themes index`);
        return themesLoadResult;
      }

      // Fallback to original numpy files
      const numpyLoadResult = await this.loadFromNumpyFiles();
      if (numpyLoadResult.success) {
        this.initialized = true;
        
        // Initialize frequency service for better word selection
        try {
          this.frequencyService = new WordFrequencyService();
          await this.frequencyService.initialize();
          console.log(`✅ Frequency service initialized`);
        } catch (error) {
          console.warn('⚠️ Failed to initialize frequency service, falling back to random selection:', error);
        }

        // Initialize spell check service for quality controls
        try {
          this.spellCheckService = new SpellCheckService();
          await this.spellCheckService.initialize();
          console.log(`✅ Spell check service initialized`);
        } catch (error) {
          console.warn('⚠️ Failed to initialize spell check service, falling back to substring checking:', error);
        }
        
        console.log(`✅ Loaded ${numpyLoadResult.loadedWords} words from numpy files`);
        return numpyLoadResult;
      }

      throw new Error('Failed to load vector data from any source');
    } catch (error) {
      console.error('❌ Failed to initialize FullVectorLoader:', error);
      return {
        totalWords: 0,
        loadedWords: 0,
        dimension: 0,
        success: false
      };
    }
  }

  /**
   * Load vectors from the themes binary index (preferred method)
   */
  private async loadFromThemesIndex(): Promise<VectorLoadResult> {
    try {
      // Try multiple possible data directories
      const possibleBasePaths = [
        path.resolve(process.cwd(), '../datascience/themes_quality/data'),
        path.resolve(process.cwd(), '../datascience/themes_index'),
        path.resolve(process.cwd(), '../../datascience/themes_quality/data'),
        path.resolve(process.cwd(), 'scripts/datascience/themes_quality/data'),
      ];
      
      let dataPath: string | null = null;
      let vocabPath: string | null = null;
      let vectorsPath: string | null = null;
      let metadataPath: string | null = null;
      let isLemmatized = false;
      
      // Try lemmatized versions first, then fallback to original
      for (const basePath of possibleBasePaths) {
        // Try lemmatized versions first
        const lemmatizedVocabPath = path.join(basePath, 'themes_vocabulary_lemmatized.json');
        const lemmatizedVectorsPath = path.join(basePath, 'themes_vectors_lemmatized.bin');
        const lemmatizedMetadataPath = path.join(basePath, 'themes_metadata_lemmatized.json');
        
        if (fs.existsSync(lemmatizedVocabPath) && fs.existsSync(lemmatizedVectorsPath) && fs.existsSync(lemmatizedMetadataPath)) {
          dataPath = basePath;
          vocabPath = lemmatizedVocabPath;
          vectorsPath = lemmatizedVectorsPath;
          metadataPath = lemmatizedMetadataPath;
          isLemmatized = true;
          break;
        }
        
        // Try original versions
        const originalVocabPath = path.join(basePath, 'themes_vocabulary.json');
        const originalVectorsPath = path.join(basePath, 'themes_vectors.bin');
        const originalMetadataPath = path.join(basePath, 'themes_metadata.json');
        
        if (fs.existsSync(originalVocabPath) && fs.existsSync(originalVectorsPath) && fs.existsSync(originalMetadataPath)) {
          dataPath = basePath;
          vocabPath = originalVocabPath;
          vectorsPath = originalVectorsPath;
          metadataPath = originalMetadataPath;
          isLemmatized = false;
          break;
        }
      }
      
      if (!dataPath || !vocabPath || !vectorsPath || !metadataPath) {
        console.log('⚠️ Themes index files not found, falling back to numpy files');
        return { totalWords: 0, loadedWords: 0, dimension: 0, success: false };
      }

      console.log(`📂 Loading vectors from themes binary index ${isLemmatized ? '(lemmatized)' : '(original)'}...`);
      console.log(`   Data path: ${dataPath}`);
      
      // Load metadata
      const metadataData = fs.readFileSync(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataData);
      
      console.log(`📊 Index metadata: ${metadata.num_vectors} vectors, dimension ${metadata.dimension}`);
      
      // Load vocabulary
      const vocabData = fs.readFileSync(vocabPath, 'utf8');
      this.fullVocabulary = JSON.parse(vocabData) as string[];
      
      // Load vectors from binary file
      const vectorBuffer = fs.readFileSync(vectorsPath);
      
      // Read header (num_vectors, dimension)
      const headerSize = 8; // 2 * 4 bytes
      const numVectors = vectorBuffer.readUInt32LE(0);
      const dimension = vectorBuffer.readUInt32LE(4);
      
      console.log(`📁 Binary file: ${numVectors} vectors, dimension ${dimension}`);
      
      // Verify consistency
      if (numVectors !== this.fullVocabulary.length) {
        throw new Error(`Vector count mismatch: vocabulary=${this.fullVocabulary.length}, binary=${numVectors}`);
      }
      
      // Initialize FAISS index
      this.faissIndex = new faiss.IndexFlatIP(dimension);
      
      // Read vector data
      const vectorDataSize = numVectors * dimension * 4; // 4 bytes per float32
      const vectorData = vectorBuffer.subarray(headerSize, headerSize + vectorDataSize);
      
      // Convert to Float32Array for processing
      const vectors = new Float32Array(vectorData.buffer, vectorData.byteOffset, numVectors * dimension);
      
      // Load vectors into FAISS index with progress logging
      let loadedCount = 0;
      
      console.log(`🔄 Loading ${numVectors} vectors into FAISS index...`);
      
      for (let i = 0; i < numVectors; i++) {
        const word = this.fullVocabulary[i];
        const vectorStart = i * dimension;
        const vector = Array.from(vectors.subarray(vectorStart, vectorStart + dimension));
        
        // Normalize vector for cosine similarity (since we're using IndexFlatIP)
        const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        const normalizedVector = norm > 0 ? vector.map(val => val / norm) : vector;
        
        const faissIndex = this.faissIndex.ntotal();
        this.faissIndex.add(normalizedVector);
        
        this.wordToIndex.set(word, faissIndex);
        this.indexToWord.set(faissIndex, word);
        this.vectorCache.set(faissIndex, normalizedVector); // Cache the normalized vector
        loadedCount++;
        
        // Log progress every 50000 words
        if ((i + 1) % 50000 === 0) {
          console.log(`   📈 Processed ${i + 1}/${numVectors} vectors... (${loadedCount} suitable)`);
        }
      }

      console.log(`✅ Loaded ${loadedCount} vectors from ${numVectors} total vectors`);
      
      return {
        totalWords: numVectors,
        loadedWords: loadedCount,
        dimension: dimension,
        success: true
      };
    } catch (error) {
      console.error('❌ Failed to load from themes index:', error);
      return { totalWords: 0, loadedWords: 0, dimension: 0, success: false };
    }
  }

  /**
   * Load vectors from original numpy files (fallback method)
   */
  private async loadFromNumpyFiles(): Promise<VectorLoadResult> {
    try {
      console.log('📂 Loading vectors from numpy files...');
      
      const vectorPath = path.resolve(process.cwd(), 'scripts/datascience/word_vectors.npy');
      const vocabPath = path.resolve(process.cwd(), 'scripts/datascience/word_vocab.json');
      
      if (!fs.existsSync(vectorPath) || !fs.existsSync(vocabPath)) {
        throw new Error('Numpy vector files not found');
      }

      // Load vocabulary
      const vocabData = fs.readFileSync(vocabPath, 'utf8');
      this.fullVocabulary = JSON.parse(vocabData) as string[];
      
      console.log(`📊 Loaded vocabulary: ${this.fullVocabulary.length} words`);

      // For numpy files, we need additional processing
      // This is a simplified implementation - in reality, you'd need a numpy file reader
      console.log('⚠️ Numpy file loading not implemented - use convert scripts first');
      
      return {
        totalWords: this.fullVocabulary.length,
        loadedWords: 0,
        dimension: 300,
        success: false
      };
    } catch (error) {
      console.error('❌ Failed to load from numpy files:', error);
      return { totalWords: 0, loadedWords: 0, dimension: 0, success: false };
    }
  }

  /**
   * Find nearest neighbors with quality controls applied
   * Filters results to include only words that:
   * 1. Meet the specified frequency percentile threshold
   * 2. Do not have the same canonical form (base word) as the theme word (using spell-checker + lemmatizer)
   * 3. Do not have the same canonical form (base word) as any existing selected words (using spell-checker + lemmatizer)
   */
  async findNearestWithQualityControls(themeWord: string, k: number, existingWords: Set<string> = new Set(), frequencyThreshold: number): Promise<SearchResult[]> {
    if (!this.initialized || !this.faissIndex) {
      throw new Error('FullVectorLoader not initialized');
    }

    // First check if the theme word has the same canonical form as existing words
    if (this.spellCheckService) {
      try {
        const matchResult = this.spellCheckService.hasMatchingCanonicalForm(themeWord, existingWords);
        if (matchResult.hasMatch) {
          console.log(`🔍 Theme word "${themeWord}" has same canonical form as existing word "${matchResult.matchingWord}" (both: "${matchResult.canonicalForm}")`);
          return []; // Return empty results - can't use this theme word
        }
      } catch (error) {
        console.warn(`⚠️ Canonical form check error for theme word "${themeWord}", using fallback check:`, error);
        // Fallback to case-insensitive check
        const themeWordLower = themeWord.toLowerCase();
        for (const existingWord of existingWords) {
          if (themeWordLower === existingWord.toLowerCase()) {
            console.log(`🔍 Theme word "${themeWord}" is case-insensitive duplicate of existing word "${existingWord}" (fallback)`);
            return [];
          }
        }
      }
    } else {
      // Fallback to case-insensitive check if spell checker not available
      const themeWordLower = themeWord.toLowerCase();
      for (const existingWord of existingWords) {
        if (themeWordLower === existingWord.toLowerCase()) {
          console.log(`🔍 Theme word "${themeWord}" is case-insensitive duplicate of existing word "${existingWord}" (no spell checker)`);
          return [];
        }
      }
    }

    const maxAttempts = k * 5; // Search up to 5x more words to find k quality words
    const batchSize = Math.max(20, k * 2); // Search in batches for efficiency
    const qualityResults: SearchResult[] = [];
    let searchedSoFar = 0;

    console.log(`🔍 Finding ${k} quality-controlled neighbors for "${themeWord}"`);

    while (qualityResults.length < k && searchedSoFar < maxAttempts) {
      // Search for a batch of candidates
      const candidatesNeeded = Math.min(batchSize, maxAttempts - searchedSoFar);
      const candidates = await this.findNearest(themeWord, searchedSoFar + candidatesNeeded);
      
      if (candidates.length === 0) {
        console.log(`⚠️ No more candidates found for "${themeWord}"`);
        break;
      }

      // Get the new candidates from this batch (skip ones we've already processed)
      const newCandidates = candidates.slice(searchedSoFar);
      
      // Apply quality controls to new candidates
      for (const candidate of newCandidates) {
        if (qualityResults.length >= k) break;
        
        if (this.passesQualityControls(candidate.word, themeWord, existingWords, frequencyThreshold)) {
          qualityResults.push(candidate);
          console.log(`   ✅ Quality word: "${candidate.word}" (similarity: ${candidate.similarity.toFixed(3)})`);
        } else {
          console.log(`   ❌ Rejected: "${candidate.word}" (failed quality controls)`);
        }
      }
      
      searchedSoFar = candidates.length;
    }

    if (qualityResults.length < k) {
      console.log(`⚠️ Only found ${qualityResults.length}/${k} quality words for "${themeWord}"`);
    }

    return qualityResults;
  }

  /**
   * Check if a word passes quality control filters
   */
  private passesQualityControls(word: string, themeWord: string, existingWords: Set<string>, frequencyThreshold: number): boolean {
    // Control 1: Must meet the specified frequency threshold
    if (!this.meetsFrequencyThreshold(word, frequencyThreshold)) {
      return false;
    }

    // Control 2: Must not have the same canonical form as the theme word
    if (this.hasSameCanonicalForm(word, themeWord)) {
      return false;
    }

    // Control 3: Must not have the same canonical form as any existing words
    if (this.hasMatchingCanonicalFormInSet(word, existingWords)) {
      return false;
    }

    return true;
  }

  /**
   * Check if word meets the specified frequency threshold
   */
  private meetsFrequencyThreshold(word: string, threshold: number): boolean {
    if (!this.frequencyService) {
      console.warn(`⚠️ No frequency service available - skipping frequency check for "${word}"`);
      return true; // If no frequency data, allow the word
    }

    // Check if the word is actually in the frequency dataset
    if (!this.frequencyService.hasWord(word)) {
      console.log(`     📊 "${word}" not in frequency dataset - skipping frequency check`);
      return true; // Skip frequency test for words not in dataset
    }

    const frequencyScore = this.frequencyService.getFrequencyScore(word);
    const meetsThreshold = frequencyScore >= threshold;
    
    if (!meetsThreshold) {
      console.log(`     📊 "${word}" frequency: ${frequencyScore.toFixed(3)} (below ${threshold.toFixed(3)} threshold)`);
    }
    
    return meetsThreshold;
  }

  /**
   * Check if word has the same canonical form as theme word using spell checker + lemmatizer
   */
  private hasSameCanonicalForm(word: string, themeWord: string): boolean {
    if (!this.spellCheckService) {
      // Fallback to substring checking if spell checker not available
      console.warn(`     ⚠️ Spell checker not available, falling back to substring check for "${word}" vs "${themeWord}"`);
      const wordLower = word.toLowerCase();
      const themeLower = themeWord.toLowerCase();
      const contains = wordLower.includes(themeLower) || themeLower.includes(wordLower);
      
      if (contains) {
        console.log(`     🔤 "${word}" contains theme word "${themeWord}" (substring fallback)`);
      }
      
      return contains;
    }

    try {
      const hasSameCanonical = this.spellCheckService.haveSameCanonicalForm(word, themeWord);
      
      if (hasSameCanonical) {
        const canonicalForm = this.spellCheckService.getCanonicalForm(word);
        console.log(`     🔤 "${word}" has same canonical form as theme word "${themeWord}" (both: "${canonicalForm}")`);
      }
      
      return hasSameCanonical;
    } catch (error) {
      console.warn(`     ⚠️ Spell check error for "${word}" vs "${themeWord}", falling back to substring: ${error}`);
      // Fallback to substring checking
      const wordLower = word.toLowerCase();
      const themeLower = themeWord.toLowerCase();
      return wordLower.includes(themeLower) || themeLower.includes(wordLower);
    }
  }

  /**
   * Check if word has the same canonical form as any existing words using spell checker + lemmatizer
   */
  private hasMatchingCanonicalFormInSet(word: string, existingWords: Set<string>): boolean {
    if (!this.spellCheckService) {
      // Fallback to substring checking if spell checker not available
      console.warn(`     ⚠️ Spell checker not available, falling back to substring check for "${word}"`);
      const wordLower = word.toLowerCase();
      
      for (const existingWord of existingWords) {
        const existingLower = existingWord.toLowerCase();
        
        // Check for exact match (case-insensitive) - this is a duplicate word
        if (wordLower === existingLower) {
          console.log(`     🔗 "${word}" is duplicate of existing word "${existingWord}" (case-insensitive)`);
          return true;
        }
        
        // Check if candidate word contains existing word or vice versa (substring containment)
        if (wordLower.includes(existingLower) || existingLower.includes(wordLower)) {
          console.log(`     🔗 "${word}" has containment with existing word "${existingWord}" (substring fallback)`);
          return true;
        }
      }
      
      return false;
    }

    try {
      const matchResult = this.spellCheckService.hasMatchingCanonicalForm(word, existingWords);
      
      if (matchResult.hasMatch) {
        console.log(`     🔗 "${word}" has same canonical form as existing word "${matchResult.matchingWord}" (both: "${matchResult.canonicalForm}")`);
      }
      
      return matchResult.hasMatch;
    } catch (error) {
      console.warn(`     ⚠️ Spell check error for "${word}" vs existing words, falling back to substring: ${error}`);
      // Fallback to substring checking
      const wordLower = word.toLowerCase();
      
      for (const existingWord of existingWords) {
        const existingLower = existingWord.toLowerCase();
        
        if (wordLower === existingLower) {
          return true;
        }
        
        if (wordLower.includes(existingLower) || existingLower.includes(wordLower)) {
          return true;
        }
      }
      
      return false;
    }
  }

  /**
   * Find nearest neighbors using FAISS KNN search (original method)
   */
  async findNearest(word: string, k: number): Promise<SearchResult[]> {
    if (!this.initialized || !this.faissIndex) {
      throw new Error('FullVectorLoader not initialized');
    }

    // Get the word's index
    const wordIndex = this.wordToIndex.get(word.toLowerCase());
    if (wordIndex === undefined) {
      console.log(`⚠️ Word "${word}" not found in loaded vocabulary`);
      return [];
    }

    try {
      // Get the query vector from cache
      const queryVector = this.vectorCache.get(wordIndex);
      if (!queryVector) {
        console.error(`❌ Vector not found in cache for word "${word}"`);
        return [];
      }

      // Search for k+1 neighbors (to exclude the query word itself)
      const searchK = Math.min(k + 1, this.faissIndex.ntotal());
      const searchResult = this.faissIndex.search(queryVector, searchK);
      
      const results: SearchResult[] = [];
      
      // Process search results - FAISS returns labels (indices) and distances
      for (let i = 0; i < searchResult.labels.length; i++) {
        const neighborIndex = searchResult.labels[i];
        const similarity = searchResult.distances[i]; // IndexFlatIP returns inner product (cosine similarity for normalized vectors)
        
        const neighborWord = this.indexToWord.get(neighborIndex);
        if (neighborWord && neighborWord !== word.toLowerCase()) {
          // Clamp similarity to [0, 1] range (should already be in this range for normalized vectors)
          const clampedSimilarity = Math.max(0, Math.min(1, similarity));
          
          results.push({
            word: neighborWord,
            similarity: clampedSimilarity
          });
        }
        
        // Stop when we have k results (excluding the query word)
        if (results.length >= k) {
          break;
        }
      }

      // Sort by similarity descending (highest similarity first)
      results.sort((a, b) => b.similarity - a.similarity);
      
      console.log(`🔍 Found ${results.length} neighbors for "${word}" (similarities: ${results.slice(0, 3).map(r => r.similarity.toFixed(3)).join(', ')}...)`);
      
      return results;
    } catch (error) {
      console.error(`❌ Failed to find neighbors for "${word}":`, error);
      return [];
    }
  }

  /**
   * Get a random seed word with frequency filtering based on difficulty
   * Uses frequency percentiles to control theme word difficulty
   * Ensures theme words are not reused across puzzle generations
   */
  getRandomSeedWordWithFrequency(frequencyThreshold: number, maxAttempts: number = 50): string {
    if (!this.frequencyService) {
      // Fallback to original method if no frequency service
      return this.getRandomSeedWordWithoutReuse();
    }

    // Try to find an unused word that meets the frequency threshold
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const word = this.frequencyService.getRandomWordAboveThreshold(frequencyThreshold);
      
      if (word) {
        // Check if word has been used before
        if (this.usedThemeWords.isWordUsed(word)) {
          continue; // Try another word
        }
        
        // Verify the word exists in our vector vocabulary
        if (this.fullVocabulary.includes(word)) {
          // Mark as used before returning
          this.usedThemeWords.markWordAsUsed(word);
          return word;
        }
      }
    }
    
    console.warn(`⚠️ Could not find unused word meeting frequency threshold ${frequencyThreshold.toFixed(3)} after ${maxAttempts} attempts, using fallback`);
    
    // Fallback to original method with reuse checking
    return this.getRandomSeedWordWithoutReuse();
  }

  /**
   * Get a random seed word without reuse checking (fallback method)
   * Prefers words in the [0.015%, 20%] frequency range for puzzle themes
   */
  getRandomSeedWordWithoutReuse(maxAttempts: number = 100): string {
    // Try to find an unused word using the original method
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const word = this.getRandomSeedWord();
      
      if (!this.usedThemeWords.isWordUsed(word)) {
        // Mark as used before returning
        this.usedThemeWords.markWordAsUsed(word);
        return word;
      }
    }
    
    console.warn(`⚠️ Could not find unused theme word after ${maxAttempts} attempts, allowing reuse`);
    
    // If we can't find an unused word after many attempts, allow reuse
    const word = this.getRandomSeedWord();
    this.usedThemeWords.markWordAsUsed(word);
    return word;
  }

  /**
   * Get a random seed word using frequency-based selection (original method)
   * Prefers words in the [0.015%, 20%] frequency range for puzzle themes
   */
  getRandomSeedWord(): string {
    if (!this.initialized) {
      throw new Error('FullVectorLoader not initialized');
    }

    // Try to use frequency-based selection for theme words (0.015%-20% range)
    if (this.frequencyService) {
      try {
        const themeWords = this.frequencyService.getThemeWords(50);
        
        // Filter to only words that exist in our vector vocabulary
        const availableWords = themeWords.filter(word => this.wordToIndex.has(word));
        
        if (availableWords.length > 0) {
          return availableWords[Math.floor(Math.random() * availableWords.length)];
        }
      } catch (error) {
        console.warn('⚠️ Failed to get frequency-based theme word, falling back to random:', error);
      }
    }

    // Fallback to random selection from vocabulary
    const words = Array.from(this.wordToIndex.keys());
    if (words.length === 0) {
      throw new Error('No words found in vocabulary');
    }
    
    return words[Math.floor(Math.random() * words.length)];
  }



  /**
   * Get statistics about loaded vectors
   */
  getStats(): {
    totalVocabulary: number;
    loadedVectors: number;
    memoryUsage: string;
  } {
    return {
      totalVocabulary: this.fullVocabulary.length,
      loadedVectors: this.faissIndex?.ntotal() || 0,
      memoryUsage: `~${Math.round((this.faissIndex?.ntotal() || 0) * 300 * 4 / 1024 / 1024)}MB`
    };
  }

  /**
   * Get statistics about used theme words
   */
  getUsedThemeWordsStats() {
    if (!this.usedThemeWords) {
      return { totalUsed: 0 };
    }
    return this.usedThemeWords.getStats();
  }

  /**
   * Check if a specific theme word has been used
   */
  isThemeWordUsed(word: string): boolean {
    if (!this.usedThemeWords) {
      return false;
    }
    return this.usedThemeWords.isWordUsed(word);
  }

  /**
   * Get all used theme words (for debugging/inspection)
   */
  getAllUsedThemeWords() {
    if (!this.usedThemeWords) {
      return [];
    }
    return this.usedThemeWords.getAllUsedWords();
  }
}