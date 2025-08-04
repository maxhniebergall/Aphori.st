/**
 * High Quality Puzzle Generator
 * Uses full vector index with progressive difficulty algorithm (N = K + D)
 */

import { FullVectorLoader, SearchResult } from './FullVectorLoader.js';

export interface GeneratedCategory {
  id: string;
  themeWord: string; // Seed word (not included in puzzle)
  words: string[]; // K words for the puzzle
  difficulty: number; // D value (1-based)
  similarity: number; // Minimum similarity among selected words
  difficultyMetrics: DifficultyMetrics;
}

export interface DifficultyMetrics {
  totalNeighbors: number;      // N value used (now equals K for N=K algorithm)
  frequencyThreshold?: number; // Frequency threshold used for difficulty control
  discardedClosest?: number;   // N-K neighbors discarded (deprecated in new algorithm)
  selectedRange: string;       // Range description like "1-4 (closest neighbors)"
}

export interface GeneratedPuzzle {
  id: string;
  date: string;
  puzzleNumber: number;
  gridSize: number;
  difficulty: number;
  categories: GeneratedCategory[];
  words: string[];
  metadata: {
    generatedAt: number;
    avgSimilarity: number;
    qualityScore: number;
  };
}

export interface GeneratedPuzzleOutput {
  date: string;
  puzzles: GeneratedPuzzle[];
  metadata: {
    generatedAt: number;
    generatorVersion: string;
    totalAttempts: number;
    successRate: number;
    qualityScore: number;
    difficultyProgression: {
      puzzleSizes: number[];
      categoryDifficulties: number[];
      algorithmUsed: string;
    };
  };
}

export interface GenerationResult {
  puzzle: GeneratedPuzzle | null;
  qualityScore: number;
  attempts: number;
}

export class HighQualityPuzzleGenerator {
  constructor(private vectorLoader: FullVectorLoader) {}

  /**
   * Generate multiple puzzles for a given date (sizes 4x4 through 10x10)
   */
  async generateDailyPuzzles(date: string, count: number = 7): Promise<GeneratedPuzzleOutput> {
    console.log(`🎯 Generating ${count} puzzles for ${date} (sizes 4x4 through 10x10)...`);
    
    // Define puzzle configurations for sizes 4x4 through 10x10
    const puzzleConfigs = [
      { size: 4, name: '4x4 Standard' },   // Progressive difficulties 1,2,3,4
      { size: 5, name: '5x5 Standard' },   // Progressive difficulties 1,2,3,4,5
      { size: 6, name: '6x6 Standard' },   // Progressive difficulties 1,2,3,4,5,6
      { size: 7, name: '7x7 Standard' },   // Progressive difficulties 1,2,3,4,5,6,7
      { size: 8, name: '8x8 Standard' },   // Progressive difficulties 1,2,3,4,5,6,7,8
      { size: 9, name: '9x9 Standard' },   // Progressive difficulties 1,2,3,4,5,6,7,8,9
      { size: 10, name: '10x10 Standard' } // Progressive difficulties 1,2,3,4,5,6,7,8,9,10
    ];
    
    const puzzles: GeneratedPuzzle[] = [];
    let totalAttempts = 0;
    const qualityScores: number[] = [];

    for (let i = 0; i < Math.min(count, puzzleConfigs.length); i++) {
      const config = puzzleConfigs[i];
      console.log(`\n🎲 Generating puzzle ${i + 1}: ${config.name}`);
      
      const result = await this.generateSinglePuzzle(date, i + 1, config.size);
      
      if (result.puzzle) {
        puzzles.push(result.puzzle);
        qualityScores.push(result.qualityScore);
        
        // Log difficulty progression
        const difficulties = result.puzzle.categories.map(cat => cat.difficulty);
        console.log(`✅ Puzzle ${i + 1} (${config.name}): Generated in ${result.attempts} attempts`);
        console.log(`   📊 Quality: ${result.qualityScore.toFixed(2)}, Difficulties: [${difficulties.join(', ')}]`);
        
        // Log difficulty details
        result.puzzle.categories.forEach((cat, idx) => {
          const metrics = cat.difficultyMetrics;
          console.log(`   📈 Category ${idx + 1} (${cat.themeWord}): N=${metrics.totalNeighbors}, range=${metrics.selectedRange}`);
        });
      }
      
      totalAttempts += result.attempts;
    }

    return {
      date,
      puzzles,
      metadata: {
        generatedAt: Date.now(),
        generatorVersion: '1.0.0',
        totalAttempts,
        successRate: puzzles.length / count,
        qualityScore: qualityScores.length > 0 ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : 0,
        difficultyProgression: {
          puzzleSizes: [4, 5, 6, 7, 8, 9, 10], // All generated puzzle sizes
          categoryDifficulties: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // Progressive difficulty up to max size
          algorithmUsed: 'N=K with frequency-based difficulty'
        }
      }
    };
  }

  /**
   * Generate a single puzzle with progressive difficulty
   */
  private async generateSinglePuzzle(date: string, puzzleNumber: number, puzzleSize: number = 4): Promise<GenerationResult> {
    const maxAttempts = 100;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const categories: GeneratedCategory[] = [];
      const usedWords = new Set<string>();

      // Generate categories with progressive difficulty using N = K + D algorithm
      for (let catIndex = 0; catIndex < puzzleSize; catIndex++) {
        const category = await this.generateCategory(usedWords, catIndex, puzzleSize);
        
        if (category && this.validateCategory(category)) {
          categories.push(category);
          category.words.forEach(word => usedWords.add(word));
        } else {
          break; // Failed to generate valid category, restart puzzle
        }
      }

      if (categories.length === puzzleSize) {
        const puzzle = this.assemblePuzzle(date, puzzleNumber, categories);
        const qualityScore = this.calculatePuzzleQuality(puzzle);
        
        if (qualityScore >= 0.5) { // Quality threshold for automation
          return {
            puzzle,
            qualityScore,
            attempts: attempt
          };
        }
      }
    }

    console.log(`❌ Failed to generate puzzle ${puzzleNumber} after ${maxAttempts} attempts`);
    return {
      puzzle: null,
      qualityScore: 0,
      attempts: maxAttempts
    };
  }

  /**
   * Generate a single category using N=K frequency-based difficulty algorithm
   */
  private async generateCategory(usedWords: Set<string>, categoryIndex: number, puzzleSize: number = 4): Promise<GeneratedCategory | null> {
    const maxAttempts = 20;
    
    // New frequency-based difficulty algorithm: N = K
    // Where K = puzzle size, difficulty controlled by frequency threshold
    const K = puzzleSize;
    const N = K; // Find exactly K neighbors (no extra for discarding)
    const D = categoryIndex + 1; // Convert 0-based index to 1-based difficulty
    
    // Calculate frequency threshold based on difficulty
    const frequencyThreshold = this.calculateFrequencyThreshold(D, puzzleSize);
    
    console.log(`🎯 Generating category ${categoryIndex + 1}: K=${K}, N=${N} (theme word frequency threshold: ${frequencyThreshold.toFixed(3)})`);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Get theme word with frequency filtering based on difficulty
        // Frequency threshold applies only to theme word selection, not to puzzle words
        const seedWord = this.vectorLoader.getRandomSeedWordWithFrequency(frequencyThreshold);
        if (usedWords.has(seedWord)) continue;

        // Find N nearest neighbors with standard quality controls 
        // Selected puzzle words use general quality controls (0.3 frequency threshold)
        const allCandidates = await this.vectorLoader.findNearestWithQualityControls(seedWord, N + 5, usedWords);
        
        // If no candidates found (word not in vocabulary), try a different word
        if (allCandidates.length === 0) {
          continue;
        }
        
        const availableCandidates = allCandidates.filter(c => !usedWords.has(c.word));

        if (availableCandidates.length >= K) {
          // Apply frequency-based difficulty algorithm:
          // Take the K closest neighbors (highest similarity)
          // Difficulty controlled by frequency threshold, not by distance
          
          const selectedCandidates = availableCandidates.slice(0, K);
          const selectedWords = selectedCandidates.map(c => c.word);

          console.log(`   ✅ Category ${categoryIndex + 1}: Using ${K} closest neighbors (theme freq: ${frequencyThreshold.toFixed(3)})`);
          console.log(`   🎲 Theme: "${seedWord}" → Puzzle words: [${selectedWords.join(', ')}]`);

          return {
            id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            themeWord: seedWord, // Seed word is the theme, not in puzzle
            words: selectedWords,
            difficulty: D,
            similarity: Math.min(...selectedCandidates.map(c => c.similarity)),
            difficultyMetrics: {
              totalNeighbors: K,
              frequencyThreshold: frequencyThreshold,
              selectedRange: `1-${K} (closest neighbors)`
            }
          };
        }
      } catch (error) {
        console.error(`   ❌ Error in category generation attempt ${attempt + 1}:`, error);
      }
    }

    console.log(`   ❌ Failed to generate category ${categoryIndex + 1} with difficulty N=${N}`);
    return null;
  }

  /**
   * Calculate frequency threshold based on category difficulty
   * Early categories (1-2): 0.1-2 percentile = very common words (0.98-0.999 threshold)
   * Later categories: up to 50 percentile = less common words (0.5 threshold)
   */
  private calculateFrequencyThreshold(difficulty: number, maxDifficulty: number): number {
    // Map difficulty to frequency threshold:
    // difficulty 1: 0.1% = 99.9th percentile = 0.999 threshold (most common words)
    // difficulty 2: 2% = 98th percentile = 0.98 threshold (very common words)  
    // difficulty maxDifficulty: 50% = 50th percentile = 0.5 threshold (moderately common words)
    
    const minThreshold = 0.5;   // 50th percentile (moderately common words)
    const maxThreshold = 0.999; // 99.9th percentile (most common words)
    
    if (difficulty === 1) {
      return maxThreshold; // Most common words (0.1 percentile)
    } else if (difficulty === 2) {
      return 0.98; // Very common words (2 percentile)
    } else {
      // Linear interpolation from 0.98 (difficulty 2) to 0.5 (max difficulty)
      const ratio = (difficulty - 2) / (maxDifficulty - 2);
      const threshold = 0.98 - (ratio * (0.98 - minThreshold));
      return Math.max(minThreshold, threshold);
    }
  }

  /**
   * Validate a generated category
   */
  private validateCategory(category: GeneratedCategory): boolean {
    // Check word count
    if (category.words.length !== 4) {
      return false;
    }

    // Check for duplicate words
    const uniqueWords = new Set(category.words);
    if (uniqueWords.size !== category.words.length) {
      return false;
    }

    // Check minimum similarity threshold
    if (category.similarity < 0.3) {
      return false;
    }

    // Basic word validation
    for (const word of category.words) {
      if (!word || typeof word !== 'string' || word.length < 2) {
        return false;
      }
    }

    return true;
  }

  /**
   * Simple puzzle quality based on similarity scores
   */
  private calculateSimpleQuality(categories: GeneratedCategory[]): number {
    const avgSimilarity = categories.reduce((sum, cat) => sum + cat.similarity, 0) / categories.length;
    return Math.max(0.3, Math.min(1, avgSimilarity));
  }

  /**
   * Assemble final puzzle from categories
   */
  private assemblePuzzle(date: string, puzzleNumber: number, categories: GeneratedCategory[]): GeneratedPuzzle {
    const allWords = categories.flatMap(cat => cat.words);
    
    return {
      id: `themes_${date}_${puzzleNumber}`,
      date,
      puzzleNumber,
      gridSize: 4,
      difficulty: this.determineDifficulty(categories),
      categories: categories.map(cat => ({
        id: cat.id,
        themeWord: cat.themeWord,
        words: cat.words,
        difficulty: cat.difficulty,
        similarity: cat.similarity,
        difficultyMetrics: cat.difficultyMetrics
      })),
      words: this.shuffleArray(allWords),
      metadata: {
        generatedAt: Date.now(),
        avgSimilarity: categories.reduce((sum, cat) => sum + cat.similarity, 0) / categories.length,
        qualityScore: this.calculateSimpleQuality(categories)
      }
    };
  }

  /**
   * Determine overall puzzle difficulty
   */
  private determineDifficulty(categories: GeneratedCategory[]): number {
    // Average of category difficulties
    const avgDifficulty = categories.reduce((sum, cat) => sum + cat.difficulty, 0) / categories.length;
    
    // Adjust based on average similarity (lower similarity = higher difficulty)
    const avgSimilarity = categories.reduce((sum, cat) => sum + cat.similarity, 0) / categories.length;
    const similarityAdjustment = (1 - avgSimilarity) * 2; // 0-2 adjustment
    
    const finalDifficulty = avgDifficulty + similarityAdjustment;
    
    // Clamp to 1-10 scale
    return Math.max(1, Math.min(10, Math.round(finalDifficulty)));
  }

  /**
   * Calculate overall puzzle quality based on similarity and structure
   */
  private calculatePuzzleQuality(puzzle: GeneratedPuzzle): number {
    let qualityScore = 0;
    
    // Average similarity (60% weight)
    const avgSimilarity = puzzle.categories.reduce((sum, cat) => sum + cat.similarity, 0) / puzzle.categories.length;
    qualityScore += avgSimilarity * 0.6;
    
    // Difficulty progression (30% weight)
    const hasGoodProgression = this.checkDifficultyProgression(puzzle.categories);
    qualityScore += (hasGoodProgression ? 1 : 0.5) * 0.3;
    
    // Word diversity (10% weight)
    const wordDiversity = this.calculateWordDiversity(puzzle.words);
    qualityScore += wordDiversity * 0.1;
    
    return Math.max(0, Math.min(1, qualityScore));
  }

  /**
   * Check if categories have good difficulty progression
   */
  private checkDifficultyProgression(categories: GeneratedCategory[]): boolean {
    const difficulties = categories.map(cat => cat.difficulty);
    
    // Check if difficulties are in ascending order
    for (let i = 1; i < difficulties.length; i++) {
      if (difficulties[i] < difficulties[i - 1]) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Calculate word diversity score
   */
  private calculateWordDiversity(words: string[]): number {
    // Check length diversity
    const lengths = words.map(word => word.length);
    const uniqueLengths = new Set(lengths);
    const lengthDiversity = uniqueLengths.size / lengths.length;
    
    // Check letter diversity
    const allLetters = words.join('').split('');
    const uniqueLetters = new Set(allLetters);
    const letterDiversity = Math.min(1, uniqueLetters.size / 15); // Normalize to expected letter count
    
    return (lengthDiversity + letterDiversity) / 2;
  }

  /**
   * Shuffle array utility
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}