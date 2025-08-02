/**
 * Themes Vector Service - Separate vector search system for word puzzle games
 * Completely isolated from main Aphorist vector search functionality
 */

import faiss from 'faiss-node';
import { LoggedDatabaseClient } from '../../db/LoggedDatabaseClient.js';
import { 
  ThemesVectorEntry,
  ThemesVectorIndexMetadata,
  ThemesVectorShard,
  THEMES_DB_PATHS,
  THEMES_CONFIG
} from '../../types/games/themes.js';
import { EmbeddingProvider } from '../embeddingProvider.js';
import logger from '../../logger.js';

const MAX_THEMES_INDEX_SIZE = 10000; // Max words in memory FAISS index
const MIN_SIMILARITY_THRESHOLD = 0.5; // Minimum similarity for meaningful results
const MAX_SIMILARITY_RESULTS = 50; // Maximum results per similarity search

export interface ThemesSimilarityResult {
  word: string;
  similarity: number;
  metadata?: any;
}

export class ThemesVectorService {
  private embeddingProvider: EmbeddingProvider;
  private faissIndex: faiss.IndexFlatL2 | null = null;
  private wordToFaissIndex: Map<string, number> = new Map(); // Map word to FAISS internal index
  private faissIndexToWord: Map<number, string> = new Map(); // Map FAISS internal index to word
  private firebaseClient: LoggedDatabaseClient;
  private initialized: boolean = false;

  constructor(firebaseClient: LoggedDatabaseClient, embeddingProvider: EmbeddingProvider) {
    this.firebaseClient = firebaseClient;
    this.embeddingProvider = embeddingProvider;
  }

  /**
   * Initialize the themes vector index from stored data
   */
  async initializeIndex(): Promise<void> {
    if (this.initialized) {
      logger.debug('ThemesVectorService already initialized');
      return;
    }

    logger.info('Initializing Themes Vector Service...');
    
    try {
      // Initialize FAISS index
      const dimension = THEMES_CONFIG.VECTOR_DIMENSION;
      this.faissIndex = new faiss.IndexFlatL2(dimension);
      
      // Clear existing mappings
      this.wordToFaissIndex.clear();
      this.faissIndexToWord.clear();

      // Load existing vectors from database
      await this.loadExistingVectors();
      
      this.initialized = true;
      logger.info(`ThemesVectorService initialized with ${this.faissIndex.ntotal()} vectors`);
    } catch (error) {
      logger.error('Failed to initialize ThemesVectorService:', error);
      throw new Error('Failed to initialize themes vector service');
    }
  }

  /**
   * Load existing vectors from database into FAISS index
   */
  private async loadExistingVectors(): Promise<void> {
    try {
      // First try to load from external vector files
      const loadedFromFiles = await this.loadVectorsFromExternalFiles();
      if (loadedFromFiles) {
        logger.info(`Loaded vectors from external files into themes FAISS index`);
        return;
      }

      // Fallback to database vectors
      const metadata = await this.getVectorIndexMetadata();
      if (!metadata || metadata.totalWords === 0) {
        logger.info('No existing themes vectors found');
        return;
      }

      logger.info(`Loading ${metadata.totalWords} theme words from database...`);
      const shardIds = Object.keys(metadata.shards);
      
      for (const shardId of shardIds) {
        await this.loadVectorsFromShard(shardId);
      }

      logger.info(`Loaded ${this.faissIndex?.ntotal() || 0} vectors into themes FAISS index`);
    } catch (error) {
      logger.error('Failed to load existing vectors:', error);
      // Continue with empty index rather than failing
    }
  }

  /**
   * Load vectors from a specific shard
   */
  private async loadVectorsFromShard(shardId: string): Promise<void> {
    try {
      const shardPath = THEMES_DB_PATHS.THEMES_VECTOR_SHARD(shardId);
      const shardData = await this.firebaseClient.getRawPath(shardPath);
      
      if (!shardData || !shardData.vectors) {
        logger.warn(`No vectors found in shard ${shardId}`);
        return;
      }

      const vectors = shardData.vectors as Record<string, ThemesVectorEntry>;
      let loadedCount = 0;

      for (const [word, entry] of Object.entries(vectors)) {
        if (this.faissIndex && this.faissIndex.ntotal() < MAX_THEMES_INDEX_SIZE) {
          const faissIndex = this.faissIndex.ntotal();
          this.faissIndex.add(entry.vector);
          
          this.wordToFaissIndex.set(word, faissIndex);
          this.faissIndexToWord.set(faissIndex, word);
          loadedCount++;
        }
      }

      logger.debug(`Loaded ${loadedCount} vectors from shard ${shardId}`);
    } catch (error) {
      logger.error(`Failed to load vectors from shard ${shardId}:`, error);
    }
  }

  /**
   * Load vectors from binary index files
   */
  private async loadVectorsFromExternalFiles(): Promise<boolean> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const indexDir = path.resolve(process.cwd(), 'scripts/datascience/themes_index');
      const vocabPath = path.join(indexDir, 'themes_vocabulary.json');
      const vectorsPath = path.join(indexDir, 'themes_vectors.bin');
      const metadataPath = path.join(indexDir, 'themes_metadata.json');
      
      if (!fs.existsSync(vocabPath) || !fs.existsSync(vectorsPath) || !fs.existsSync(metadataPath)) {
        logger.info('Binary theme index files not found, will use database vectors');
        return false;
      }

      logger.info('Loading vectors from binary index files...');
      
      // Load metadata
      const metadataData = fs.readFileSync(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataData);
      
      logger.info(`Index metadata: ${metadata.num_vectors} vectors, dimension ${metadata.dimension}`);
      
      // Load vocabulary
      const vocabData = fs.readFileSync(vocabPath, 'utf8');
      const vocabulary = JSON.parse(vocabData) as string[];
      
      // Load vectors from binary file
      const vectorBuffer = fs.readFileSync(vectorsPath);
      
      // Read header (num_vectors, dimension)
      const headerSize = 8; // 2 * 4 bytes
      const numVectors = vectorBuffer.readUInt32LE(0);
      const dimension = vectorBuffer.readUInt32LE(4);
      
      logger.info(`Binary file: ${numVectors} vectors, dimension ${dimension}`);
      
      // Verify consistency
      if (numVectors !== vocabulary.length) {
        logger.error(`Vector count mismatch: vocabulary=${vocabulary.length}, binary=${numVectors}`);
        return false;
      }
      
      if (dimension !== THEMES_CONFIG.VECTOR_DIMENSION) {
        logger.warn(`Vector dimension mismatch: expected=${THEMES_CONFIG.VECTOR_DIMENSION}, got=${dimension}`);
        // Continue anyway - we'll adapt
      }
      
      // Read vector data
      const vectorDataSize = numVectors * dimension * 4; // 4 bytes per float32
      const vectorData = vectorBuffer.subarray(headerSize, headerSize + vectorDataSize);
      
      // Convert to Float32Array for processing
      const vectors = new Float32Array(vectorData.buffer, vectorData.byteOffset, numVectors * dimension);
      
      // Load vectors into FAISS index
      const maxWords = Math.min(numVectors, MAX_THEMES_INDEX_SIZE);
      let loadedCount = 0;
      
      logger.info(`Loading up to ${maxWords} vectors into FAISS index...`);
      
      for (let i = 0; i < maxWords; i++) {
        const word = vocabulary[i];
        const vectorStart = i * dimension;
        const vector = Array.from(vectors.subarray(vectorStart, vectorStart + dimension));
        
        if (this.faissIndex && this.faissIndex.ntotal() < MAX_THEMES_INDEX_SIZE) {
          const faissIndex = this.faissIndex.ntotal();
          this.faissIndex.add(vector);
          
          this.wordToFaissIndex.set(word, faissIndex);
          this.faissIndexToWord.set(faissIndex, word);
          loadedCount++;
        }
        
        // Log progress every 10000 words
        if ((i + 1) % 10000 === 0) {
          logger.info(`Loaded ${i + 1}/${maxWords} vectors...`);
        }
      }

      logger.info(`Loaded ${loadedCount} vectors from binary index files`);
      return loadedCount > 0;
    } catch (error) {
      logger.error('Failed to load vectors from binary index files:', error);
      return false;
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
   * Add a word and its vector to the themes index
   */
  async addWord(word: string, metadata?: any): Promise<boolean> {
    if (!this.initialized) {
      await this.initializeIndex();
    }

    if (this.wordToFaissIndex.has(word)) {
      logger.debug(`Word already exists in themes index: ${word}`);
      return true; // Already exists
    }

    try {
      // Generate embedding for the word
      const vector = await this.embeddingProvider.generateEmbedding(word.trim());
      if (!vector) {
        logger.error(`Failed to generate embedding for word: ${word}`);
        return false;
      }

      // Validate vector dimension
      if (vector.length !== THEMES_CONFIG.VECTOR_DIMENSION) {
        logger.error(`Vector dimension mismatch for word ${word}: expected ${THEMES_CONFIG.VECTOR_DIMENSION}, got ${vector.length}`);
        return false;
      }

      // Create vector entry
      const vectorEntry: ThemesVectorEntry = {
        word: word,
        vector: vector,
        metadata: metadata || {}
      };

      // Store in database
      await this.storeVectorInDatabase(word, vectorEntry);

      // Add to FAISS index if there's space
      if (this.faissIndex && this.faissIndex.ntotal() < MAX_THEMES_INDEX_SIZE) {
        const faissIndex = this.faissIndex.ntotal();
        this.faissIndex.add(vector);
        
        this.wordToFaissIndex.set(word, faissIndex);
        this.faissIndexToWord.set(faissIndex, word);
      }

      logger.debug(`Added word to themes index: ${word}`);
      return true;
    } catch (error) {
      logger.error(`Failed to add word ${word} to themes index:`, error);
      return false;
    }
  }

  /**
   * Find similar words to a given word
   */
  async findSimilarWords(word: string, count: number = 10): Promise<ThemesSimilarityResult[]> {
    if (!this.initialized) {
      await this.initializeIndex();
    }

    if (!this.faissIndex || this.faissIndex.ntotal() === 0) {
      logger.warn('Themes FAISS index is empty');
      return [];
    }

    try {
      // Generate embedding for query word
      const queryVector = await this.embeddingProvider.generateEmbedding(word.trim());
      if (!queryVector) {
        logger.error(`Failed to generate embedding for query word: ${word}`);
        return [];
      }

      // Search for similar vectors
      const k = Math.min(count, Math.min(MAX_SIMILARITY_RESULTS, this.faissIndex.ntotal()));
      const searchResult = this.faissIndex.search(queryVector, k);

      const results: ThemesSimilarityResult[] = [];
      
      for (let i = 0; i < searchResult.labels.length; i++) {
        const faissIndex = searchResult.labels[i];
        const distance = searchResult.distances[i];
        
        // Convert L2 distance to similarity score (cosine-like)
        const similarity = Math.max(0, 1 - (distance / 2));
        
        if (similarity < MIN_SIMILARITY_THRESHOLD) {
          continue; // Skip low similarity results
        }

        const similarWord = this.faissIndexToWord.get(faissIndex);
        if (similarWord && similarWord !== word) { // Exclude the query word itself
          results.push({
            word: similarWord,
            similarity: similarity,
            metadata: {} // TODO: Add metadata if needed
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
   * Batch add multiple words to the index
   */
  async addWords(words: string[]): Promise<{ added: number; failed: number }> {
    let added = 0;
    let failed = 0;

    logger.info(`Adding ${words.length} words to themes index...`);

    for (const word of words) {
      try {
        const success = await this.addWord(word);
        if (success) {
          added++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error(`Failed to add word ${word}:`, error);
        failed++;
      }
    }

    logger.info(`Batch add complete: ${added} added, ${failed} failed`);
    return { added, failed };
  }

  /**
   * Store vector in database shard system
   */
  private async storeVectorInDatabase(word: string, vectorEntry: ThemesVectorEntry): Promise<void> {
    try {
      // Get or create metadata
      let metadata = await this.getVectorIndexMetadata();
      if (!metadata) {
        metadata = {
          totalWords: 0,
          dimension: THEMES_CONFIG.VECTOR_DIMENSION,
          shards: {},
          lastUpdated: Date.now(),
          version: '1.0.0'
        };
      }

      // Find or create appropriate shard
      const shardId = await this.findOrCreateShard(metadata);
      const shardPath = THEMES_DB_PATHS.THEMES_VECTOR_SHARD(shardId);
      
      // Get existing shard data
      const existingShardData = await this.firebaseClient.getRawPath(shardPath) || { vectors: {} };
      
      // Add vector to shard
      existingShardData.vectors[word] = vectorEntry;
      
      // Update shard data
      await this.firebaseClient.setRawPath(shardPath, existingShardData);
      
      // Update metadata
      metadata.totalWords += 1;
      metadata.lastUpdated = Date.now();
      metadata.shards[shardId].wordCount += 1;
      
      await this.firebaseClient.setRawPath(THEMES_DB_PATHS.THEMES_VECTOR_METADATA, metadata);
      
      logger.debug(`Stored vector for word ${word} in shard ${shardId}`);
    } catch (error) {
      logger.error(`Failed to store vector for word ${word}:`, error);
      throw error;
    }
  }

  /**
   * Find existing shard with space or create new one
   */
  private async findOrCreateShard(metadata: ThemesVectorIndexMetadata): Promise<string> {
    const SHARD_CAPACITY = 1000; // Words per shard
    
    // Look for existing shard with space
    for (const [shardId, shard] of Object.entries(metadata.shards)) {
      if (shard.wordCount < SHARD_CAPACITY) {
        return shardId;
      }
    }

    // Create new shard
    const newShardId = `shard_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const newShard: ThemesVectorShard = {
      id: newShardId,
      wordCount: 0,
      createdAt: Date.now()
    };

    metadata.shards[newShardId] = newShard;
    return newShardId;
  }

  /**
   * Get vector index metadata
   */
  private async getVectorIndexMetadata(): Promise<ThemesVectorIndexMetadata | null> {
    try {
      return await this.firebaseClient.getRawPath(THEMES_DB_PATHS.THEMES_VECTOR_METADATA);
    } catch (error) {
      logger.error('Failed to get themes vector metadata:', error);
      return null;
    }
  }

  /**
   * Get statistics about the themes vector index
   */
  async getIndexStats(): Promise<{
    totalWords: number;
    loadedInMemory: number;
    shardCount: number;
    dimension: number;
  }> {
    const metadata = await this.getVectorIndexMetadata();
    
    return {
      totalWords: metadata?.totalWords || 0,
      loadedInMemory: this.faissIndex?.ntotal() || 0,
      shardCount: metadata ? Object.keys(metadata.shards).length : 0,
      dimension: THEMES_CONFIG.VECTOR_DIMENSION
    };
  }

  /**
   * Clear the entire themes vector index (for testing/reset)
   */
  async clearIndex(): Promise<void> {
    logger.warn('Clearing entire themes vector index...');
    
    try {
      // Clear FAISS index
      this.faissIndex = new faiss.IndexFlatL2(THEMES_CONFIG.VECTOR_DIMENSION);
      this.wordToFaissIndex.clear();
      this.faissIndexToWord.clear();
      
      // Clear database storage
      await this.firebaseClient.removeRawPath(THEMES_DB_PATHS.THEMES_VECTOR_INDEX);
      
      logger.warn('Themes vector index cleared');
    } catch (error) {
      logger.error('Failed to clear themes vector index:', error);
      throw error;
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
}