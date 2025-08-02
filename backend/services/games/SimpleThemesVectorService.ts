/**
 * Simple Themes Vector Service
 * Loads binary index directly and provides similarity search for themes game
 * No database storage, no word management - just fast similarity search
 */

import faiss from 'faiss-node';
import logger from '../../logger.js';

const MAX_THEMES_INDEX_SIZE = 50000; // Limit for performance
const MIN_SIMILARITY_THRESHOLD = 0.3; // Lower threshold for better category formation
const MAX_SIMILARITY_RESULTS = 100; // More results for better category formation

export interface ThemesSimilarityResult {
  word: string;
  similarity: number;
}

export class SimpleThemesVectorService {
  private faissIndex: faiss.IndexFlatIP | null = null; // Use Inner Product for cosine similarity
  private wordToFaissIndex: Map<string, number> = new Map();
  private faissIndexToWord: Map<number, string> = new Map();
  private wordVectors: Map<string, number[]> = new Map(); // Store normalized vectors
  private vocabulary: string[] = [];
  private initialized: boolean = false;

  constructor() {
    // No dependencies - completely self-contained
  }

  /**
   * Initialize from binary index files
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('SimpleThemesVectorService already initialized');
      return;
    }

    logger.info('Initializing Simple Themes Vector Service...');
    
    try {
      await this.loadFromBinaryIndex();
      this.initialized = true;
      logger.info(`SimpleThemesVectorService initialized with ${this.vocabulary.length} words`);
    } catch (error) {
      logger.error('Failed to initialize SimpleThemesVectorService:', error);
      throw new Error('Failed to initialize simple themes vector service');
    }
  }

  /**
   * Load vectors and vocabulary from binary index files
   */
  private async loadFromBinaryIndex(): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const indexDir = path.resolve(process.cwd(), 'scripts/datascience/themes_index');
      const vocabPath = path.join(indexDir, 'themes_vocabulary.json');
      const vectorsPath = path.join(indexDir, 'themes_vectors.bin');
      const metadataPath = path.join(indexDir, 'themes_metadata.json');
      
      if (!fs.existsSync(vocabPath) || !fs.existsSync(vectorsPath) || !fs.existsSync(metadataPath)) {
        throw new Error('Binary theme index files not found');
      }

      logger.info('Loading from binary index files...');
      
      // Load metadata
      const metadataData = fs.readFileSync(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataData);
      
      logger.info(`Index metadata: ${metadata.num_vectors} vectors, dimension ${metadata.dimension}`);
      
      // Load vocabulary
      const vocabData = fs.readFileSync(vocabPath, 'utf8');
      const fullVocabulary = JSON.parse(vocabData) as string[];
      
      // Load vectors from binary file
      const vectorBuffer = fs.readFileSync(vectorsPath);
      
      // Read header
      const numVectors = vectorBuffer.readUInt32LE(0);
      const dimension = vectorBuffer.readUInt32LE(4);
      
      logger.info(`Binary file: ${numVectors} vectors, dimension ${dimension}`);
      
      // Initialize FAISS index for cosine similarity (Inner Product with normalized vectors)
      this.faissIndex = new faiss.IndexFlatIP(dimension);
      
      // Read vector data
      const headerSize = 8;
      const vectorDataSize = numVectors * dimension * 4; // 4 bytes per float32
      const vectorData = vectorBuffer.subarray(headerSize, headerSize + vectorDataSize);
      const vectors = new Float32Array(vectorData.buffer, vectorData.byteOffset, numVectors * dimension);
      
      // Load a subset of vectors for performance
      const maxWords = Math.min(numVectors, MAX_THEMES_INDEX_SIZE);
      let loadedCount = 0;
      
      logger.info(`Loading up to ${maxWords} vectors into FAISS index...`);
      
      // Create batches for efficient loading
      const batchSize = 1000;
      const vectorBatch: number[][] = [];
      const wordBatch: string[] = [];
      
      for (let i = 0; i < maxWords; i++) {
        const word = fullVocabulary[i];
        const vectorStart = i * dimension;
        const vector = Array.from(vectors.subarray(vectorStart, vectorStart + dimension));
        
        // Normalize vector for cosine similarity
        const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        if (norm > 0) {
          for (let j = 0; j < vector.length; j++) {
            vector[j] /= norm;
          }
        }
        
        vectorBatch.push(vector);
        wordBatch.push(word);
        
        // Process batch when full
        if (vectorBatch.length === batchSize || i === maxWords - 1) {
          for (let j = 0; j < vectorBatch.length; j++) {
            const faissIndex = this.faissIndex!.ntotal();
            this.faissIndex!.add(vectorBatch[j]);
            
            const word = wordBatch[j];
            this.wordToFaissIndex.set(word, faissIndex);
            this.faissIndexToWord.set(faissIndex, word);
            this.wordVectors.set(word, vectorBatch[j]); // Store the normalized vector
            this.vocabulary.push(word);
            loadedCount++;
          }
          
          // Clear batch
          vectorBatch.length = 0;
          wordBatch.length = 0;
          
          // Log progress
          if ((i + 1) % 10000 === 0) {
            logger.info(`Loaded ${i + 1}/${maxWords} vectors...`);
          }
        }
      }

      logger.info(`Loaded ${loadedCount} normalized vectors into FAISS index`);
    } catch (error) {
      logger.error('Failed to load from binary index files:', error);
      throw error;
    }
  }

  /**
   * Find similar words to a given word
   */
  async findSimilarWords(word: string, count: number = 20): Promise<ThemesSimilarityResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.faissIndex || this.faissIndex.ntotal() === 0) {
      logger.warn('FAISS index is empty');
      return [];
    }

    try {
      // Check if word exists in our index
      const wordIndex = this.wordToFaissIndex.get(word.toLowerCase());
      if (wordIndex === undefined) {
        logger.debug(`Word not found in index: ${word}`);
        return [];
      }

      // Get the word's vector by searching for itself
      const k = Math.min(count + 1, Math.min(MAX_SIMILARITY_RESULTS, this.faissIndex.ntotal()));
      
      // Get vector for the query word
      const queryVector = this.getVectorForWord(word);
      if (!queryVector) {
        return [];
      }

      // Search for similar vectors
      const searchResult = this.faissIndex.search(queryVector, k);

      const results: ThemesSimilarityResult[] = [];
      
      for (let i = 0; i < searchResult.labels.length; i++) {
        const faissIndex = searchResult.labels[i];
        const similarity = searchResult.distances[i]; // This is inner product (cosine similarity for normalized vectors)
        
        if (similarity < MIN_SIMILARITY_THRESHOLD) {
          continue; // Skip low similarity results
        }

        const similarWord = this.faissIndexToWord.get(faissIndex);
        if (similarWord && similarWord !== word.toLowerCase()) { // Exclude the query word itself
          results.push({
            word: similarWord,
            similarity: similarity
          });
        }
      }

      // Sort by similarity descending
      results.sort((a, b) => b.similarity - a.similarity);
      
      logger.debug(`Found ${results.length} similar words for: ${word}`);
      return results.slice(0, count);
    } catch (error) {
      logger.error(`Failed to find similar words for ${word}:`, error);
      return [];
    }
  }

  /**
   * Get vector for a specific word
   */
  private getVectorForWord(word: string): number[] | null {
    return this.wordVectors.get(word.toLowerCase()) || null;
  }

  /**
   * Get random words from the vocabulary
   */
  getRandomWords(count: number): string[] {
    if (!this.initialized || this.vocabulary.length === 0) {
      return [];
    }

    const shuffled = [...this.vocabulary];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled.slice(0, count);
  }

  /**
   * Get vocabulary size
   */
  getVocabularySize(): number {
    return this.vocabulary.length;
  }

  /**
   * Check if word exists in vocabulary
   */
  hasWord(word: string): boolean {
    return this.wordToFaissIndex.has(word.toLowerCase());
  }

  /**
   * Get all words (for testing)
   */
  getAllWords(): string[] {
    return [...this.vocabulary];
  }
}