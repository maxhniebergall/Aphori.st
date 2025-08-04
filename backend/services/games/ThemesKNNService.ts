/**
 * Themes KNN Service
 * Simple k-nearest neighbors search for Connections-style puzzles
 * Load binary index, provide KNN search, that's it.
 */

import faiss from 'faiss-node';
import logger from '../../logger.js';

export interface KNNResult {
  word: string;
  similarity: number;
}

export class ThemesKNNService {
  private faissIndex: faiss.IndexFlatIP | null = null;
  private words: string[] = [];
  private wordVectors: Map<string, number[]> = new Map();
  private initialized: boolean = false;

  /**
   * Initialize KNN service from binary index
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Loading binary index for KNN search...');
    
    const fs = await import('fs');
    const path = await import('path');
    
    const indexDir = path.resolve(process.cwd(), 'scripts/datascience/themes_index');
    const vocabPath = path.join(indexDir, 'themes_vocabulary.json');
    const vectorsPath = path.join(indexDir, 'themes_vectors.bin');
    
    // Load vocabulary
    const vocabulary = JSON.parse(fs.readFileSync(vocabPath, 'utf8')) as string[];
    
    // Load vectors
    const vectorBuffer = fs.readFileSync(vectorsPath);
    const numVectors = vectorBuffer.readUInt32LE(0);
    const dimension = vectorBuffer.readUInt32LE(4);
    
    // Limit for performance
    const maxWords = Math.min(numVectors, 20000);
    
    // Initialize FAISS for cosine similarity
    this.faissIndex = new faiss.IndexFlatIP(dimension);
    
    // Load vectors
    const headerSize = 8;
    const vectors = new Float32Array(vectorBuffer.buffer, vectorBuffer.byteOffset + headerSize, numVectors * dimension);
    
    logger.info(`Loading ${maxWords} words into KNN index...`);
    
    for (let i = 0; i < maxWords; i++) {
      const word = vocabulary[i];
      const vectorStart = i * dimension;
      const vector = Array.from(vectors.subarray(vectorStart, vectorStart + dimension));
      
      // Normalize for cosine similarity
      const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
      if (norm > 0) {
        for (let j = 0; j < vector.length; j++) {
          vector[j] /= norm;
        }
      }
      
      this.faissIndex.add(vector);
      this.words.push(word);
      this.wordVectors.set(word, vector);
      
      if ((i + 1) % 5000 === 0) {
        logger.info(`Loaded ${i + 1}/${maxWords} words...`);
      }
    }
    
    this.initialized = true;
    logger.info(`KNN service ready with ${this.words.length} words`);
  }

  /**
   * Find k nearest neighbors for a word
   */
  async findNearest(word: string, k: number = 3): Promise<KNNResult[]> {
    if (!this.initialized) await this.initialize();
    
    const queryVector = this.wordVectors.get(word.toLowerCase());
    if (!queryVector) return [];
    
    // Search for k+1 to exclude the word itself
    const searchResult = this.faissIndex!.search(queryVector, k + 1);
    
    const results: KNNResult[] = [];
    for (let i = 0; i < searchResult.labels.length; i++) {
      const wordIndex = searchResult.labels[i];
      const similarity = searchResult.distances[i];
      const foundWord = this.words[wordIndex];
      
      // Skip the query word itself
      if (foundWord !== word.toLowerCase()) {
        results.push({ word: foundWord, similarity });
      }
    }
    
    return results.slice(0, k);
  }

  /**
   * Get random word from vocabulary
   */
  getRandomWord(): string {
    if (this.words.length === 0) return '';
    return this.words[Math.floor(Math.random() * this.words.length)];
  }

  /**
   * Get multiple random words
   */
  getRandomWords(count: number): string[] {
    const result: string[] = [];
    const used = new Set<string>();
    
    while (result.length < count && result.length < this.words.length) {
      const word = this.getRandomWord();
      if (!used.has(word)) {
        used.add(word);
        result.push(word);
      }
    }
    
    return result;
  }

  /**
   * Check if word exists
   */
  hasWord(word: string): boolean {
    return this.wordVectors.has(word.toLowerCase());
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      totalWords: this.words.length,
      dimension: this.wordVectors.size > 0 ? this.wordVectors.values().next().value?.length || 0 : 0,
      initialized: this.initialized
    };
  }
}