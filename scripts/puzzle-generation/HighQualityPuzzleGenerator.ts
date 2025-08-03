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
  totalNeighbors: number;      // N value used
  discardedClosest: number;    // N-K neighbors discarded
  selectedRange: string;       // Range description like "2-5"
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
      puzzleSize: number;
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
   * Generate multiple puzzles for a given date
   */
  async generateDailyPuzzles(date: string, count: number = 3): Promise<GeneratedPuzzleOutput> {
    console.log(`🎯 Generating ${count} puzzles for ${date}...`);
    
    // Define puzzle configurations
    const puzzleConfigs = [
      { size: 4, name: '4x4 Standard' },  // Progressive difficulties 1,2,3,4
      { size: 4, name: '4x4 Advanced' }, // Different seed words for variety
      { size: 4, name: '4x4 Expert' }    // Different seed words for variety
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
          puzzleSize: 4, // Primary puzzle size
          categoryDifficulties: [1, 2, 3, 4], // Standard progression
          algorithmUsed: 'N=K+D'
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
   * Generate a single category using N=K+D progressive difficulty algorithm
   */
  private async generateCategory(usedWords: Set<string>, categoryIndex: number, puzzleSize: number = 4): Promise<GeneratedCategory | null> {
    const maxAttempts = 20;
    
    // Progressive difficulty algorithm: N = K + D
    // Where K = puzzle size (4), D = difficulty (1-based category index)
    const K = puzzleSize;
    const D = categoryIndex + 1; // Convert 0-based index to 1-based difficulty
    const N = K + D; // Total neighbors to find
    
    console.log(`🎯 Generating category ${categoryIndex + 1}: K=${K}, D=${D}, N=${N} (finding ${N} neighbors, using ${K} furthest)`);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const seedWord = this.vectorLoader.getRandomSeedWord();
        if (usedWords.has(seedWord)) continue;

        // Find N nearest neighbors (more than we need)
        const allCandidates = await this.vectorLoader.findNearest(seedWord, N + 5); // Extra for filtering
        
        // If no candidates found (word not in vocabulary), try a different word
        if (allCandidates.length === 0) {
          continue;
        }
        
        const availableCandidates = allCandidates.filter(c => !usedWords.has(c.word));

        if (availableCandidates.length >= N) {
          // Apply progressive difficulty algorithm:
          // 1. Take N nearest neighbors
          // 2. Discard the N-K nearest (closest) neighbors
          // 3. Use the remaining K neighbors (furthest of the N)
          
          const nNearestNeighbors = availableCandidates.slice(0, N);
          const discardClosest = N - K; // Number of closest neighbors to discard
          const selectedCandidates = nNearestNeighbors.slice(discardClosest); // Take K furthest of N nearest
          
          if (selectedCandidates.length >= K) {
            const selectedWords = selectedCandidates.slice(0, K).map(c => c.word);

            console.log(`   ✅ Category ${categoryIndex + 1}: Using neighbors ranked ${discardClosest + 1}-${discardClosest + K} out of ${N}`);
            console.log(`   🎲 Seed: "${seedWord}" → Words: [${selectedWords.join(', ')}]`);

            return {
              id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              themeWord: seedWord, // Seed word is the theme, not in puzzle
              words: selectedWords,
              difficulty: D,
              similarity: Math.min(...selectedCandidates.slice(0, K).map(c => c.similarity)),
              difficultyMetrics: {
                totalNeighbors: N,
                discardedClosest: discardClosest,
                selectedRange: `${discardClosest + 1}-${discardClosest + K}`
              }
            };
          }
        }
      } catch (error) {
        console.error(`   ❌ Error in category generation attempt ${attempt + 1}:`, error);
      }
    }

    console.log(`   ❌ Failed to generate category ${categoryIndex + 1} with difficulty N=${N}`);
    return null;
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