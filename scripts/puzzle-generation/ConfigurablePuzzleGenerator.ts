/**
 * Configurable Puzzle Generator for Investigation
 * Extends HighQualityPuzzleGenerator with configurable parameters and algorithm variants
 */

import { HighQualityPuzzleGenerator, GeneratedCategory, GeneratedPuzzle, GenerationResult, DifficultyMetrics } from './HighQualityPuzzleGenerator.js';
import { FullVectorLoader, SearchResult } from './FullVectorLoader.js';

export interface GenerationConfig {
  algorithm: 'N=K' | 'N=K+D';
  minSimilarityThreshold?: number;
  minWordFrequencyThreshold?: number;
  maxAttempts?: number;
  qualityThreshold?: number;
  difficultyCalculation?: 'frequency' | 'distance' | 'hybrid';
  customFrequencyThresholds?: number[];
}

export interface InvestigationResult extends GenerationResult {
  config: GenerationConfig;
  generationMetrics: {
    algorithmUsed: string;
    parametersUsed: any;
    categoryGenerationTimes: number[];
    totalGenerationTime: number;
  };
}

export class ConfigurablePuzzleGenerator extends HighQualityPuzzleGenerator {
  private static readonly DEFAULT_MAX_ATTEMPTS = 100;
  private static readonly DEFAULT_QUALITY_THRESHOLD = 0.5;
  
  private config: GenerationConfig;

  constructor(vectorLoader: FullVectorLoader, config: GenerationConfig = { algorithm: 'N=K' }) {
    super(vectorLoader);
    this.config = config;
  }

  /**
   * Public method to generate single puzzle with configurable parameters
   */
  async generateConfigurablePuzzle(
    date: string, 
    puzzleNumber: number, 
    puzzleSize: number = 4,
    overrideConfig?: Partial<GenerationConfig>
  ): Promise<InvestigationResult> {
    const startTime = Date.now();
    const activeConfig = { ...this.config, ...overrideConfig };
    
    console.log(`🔬 Generating puzzle with config: ${JSON.stringify(activeConfig)}`);
    
    const maxAttempts = activeConfig.maxAttempts || ConfigurablePuzzleGenerator.DEFAULT_MAX_ATTEMPTS;
    const qualityThreshold = activeConfig.qualityThreshold || ConfigurablePuzzleGenerator.DEFAULT_QUALITY_THRESHOLD;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const categories: GeneratedCategory[] = [];
      const usedWords = new Set<string>();
      const categoryTimes: number[] = [];

      // Generate categories with configurable algorithm
      for (let catIndex = 0; catIndex < puzzleSize; catIndex++) {
        const catStartTime = Date.now();
        
        const category = await this.generateConfigurableCategory(
          usedWords, 
          catIndex, 
          puzzleSize, 
          activeConfig
        );
        
        const catTime = Date.now() - catStartTime;
        categoryTimes.push(catTime);
        
        if (category && this.validateCategoryPublic(category, puzzleSize)) {
          categories.push(category);
          category.words.forEach(word => usedWords.add(word));
        } else {
          break; // Failed to generate valid category, restart puzzle
        }
      }

      if (categories.length === puzzleSize) {
        const puzzle = this.assemblePuzzlePublic(date, puzzleNumber, categories);
        const qualityScore = this.calculatePuzzleQualityPublic(puzzle);
        
        if (qualityScore >= qualityThreshold) {
          const totalTime = Date.now() - startTime;
          
          return {
            puzzle,
            qualityScore,
            attempts: attempt,
            config: activeConfig,
            generationMetrics: {
              algorithmUsed: activeConfig.algorithm,
              parametersUsed: {
                minSimilarityThreshold: activeConfig.minSimilarityThreshold,
                minWordFrequencyThreshold: activeConfig.minWordFrequencyThreshold,
                qualityThreshold: activeConfig.qualityThreshold
              },
              categoryGenerationTimes: categoryTimes,
              totalGenerationTime: totalTime
            }
          };
        }
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`❌ Failed to generate configurable puzzle ${puzzleNumber} after ${maxAttempts} attempts`);
    
    return {
      puzzle: null,
      qualityScore: 0,
      attempts: maxAttempts,
      config: activeConfig,
      generationMetrics: {
        algorithmUsed: activeConfig.algorithm,
        parametersUsed: activeConfig,
        categoryGenerationTimes: [],
        totalGenerationTime: totalTime
      }
    };
  }

  /**
   * Generate category with configurable algorithm (N=K or N=K+D)
   */
  private async generateConfigurableCategory(
    usedWords: Set<string>, 
    categoryIndex: number, 
    puzzleSize: number,
    config: GenerationConfig
  ): Promise<GeneratedCategory | null> {
    const maxAttempts = 20;
    const K = puzzleSize;
    const D = categoryIndex + 1; // 1-based difficulty
    
    // Configure N based on algorithm
    let N: number;
    let algorithmDescription: string;
    
    switch (config.algorithm) {
      case 'N=K':
        N = K; // Current implementation
        algorithmDescription = `N=K (${N} neighbors, no discarding)`;
        break;
      case 'N=K+D':
        N = K + D; // Alternative implementation
        algorithmDescription = `N=K+D (${N} neighbors, discard ${D} furthest)`;
        break;
      default:
        N = K;
        algorithmDescription = `N=K (default, ${N} neighbors)`;
    }
    
    // Use custom frequency thresholds if provided
    const frequencyThreshold = this.calculateConfigurableFrequencyThreshold(
      D, 
      puzzleSize, 
      config.customFrequencyThresholds
    );
    
    console.log(`🎯 Generating category ${categoryIndex + 1}: ${algorithmDescription} (frequency threshold: ${frequencyThreshold.toFixed(3)})`);
    
    // Use configurable similarity threshold
    const minSimilarityThreshold = config.minSimilarityThreshold || 0.62;
    const minWordFrequencyThreshold = config.minWordFrequencyThreshold || 0.05;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Get theme word with frequency filtering
        const seedWord = this.getRandomSeedWordWithFrequencyPublic(frequencyThreshold);
        if (usedWords.has(seedWord) || (this as any).usedThemeWords.isWordUsed(seedWord)) continue;

        // Find N nearest neighbors with configurable quality controls
        const allCandidates = await this.findNearestWithQualityControlsPublic(
          seedWord, 
          N + 5, // Extra buffer for quality filtering
          usedWords, 
          minWordFrequencyThreshold
        );
        
        if (allCandidates.length === 0) {
          continue;
        }
        
        const availableCandidates = allCandidates.filter((c: any) => !usedWords.has(c.word));

        if (availableCandidates.length >= K) {
          // Apply algorithm-specific selection
          const selectedCandidates = this.selectWordsWithAlgorithm(
            availableCandidates,
            K,
            N,
            config.algorithm,
            usedWords
          );
          
          if (selectedCandidates.length < K) {
            console.log(`   ⚠️ Could only find ${selectedCandidates.length}/${K} words without containment, trying different theme`);
            continue;
          }
          
          const selectedWords = selectedCandidates.map(c => c.word);
          const minSimilarity = Math.min(...selectedCandidates.map(c => c.similarity));

          // Check configurable similarity threshold
          if (minSimilarity < minSimilarityThreshold) {
            console.log(`   ❌ Category ${categoryIndex + 1}: Similarity ${minSimilarity.toFixed(3)} below threshold ${minSimilarityThreshold}, trying different theme word`);
            (this as any).usedThemeWords.markWordAsUsed(seedWord, undefined, `generation_${Date.now()}`, minSimilarity, true);
            continue;
          }

          console.log(`   ✅ Category ${categoryIndex + 1}: Using ${algorithmDescription} (theme freq: ${frequencyThreshold.toFixed(3)}, similarity: ${minSimilarity.toFixed(3)})`);
          console.log(`   🎲 Theme: "${seedWord}" → Puzzle words: [${selectedWords.join(', ')}]`);

          // Mark theme word as successfully used
          (this as any).usedThemeWords.markWordAsUsed(seedWord, undefined, `generation_${Date.now()}`, minSimilarity, false);

          return {
            id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            themeWord: seedWord,
            words: selectedWords,
            difficulty: D,
            similarity: minSimilarity,
            difficultyMetrics: {
              totalNeighbors: N,
              frequencyThreshold: frequencyThreshold,
              discardedClosest: config.algorithm === 'N=K+D' ? D : 0,
              selectedRange: config.algorithm === 'N=K+D' 
                ? `${D+1}-${N} (discarded ${D} closest)`
                : `1-${K} (closest neighbors)`
            }
          };
        }
      } catch (error) {
        console.error(`   ❌ Error in configurable category generation attempt ${attempt + 1}:`, error);
      }
    }

    console.log(`   ❌ Failed to generate configurable category ${categoryIndex + 1} with ${algorithmDescription}`);
    return null;
  }

  /**
   * Select words based on algorithm (N=K or N=K+D)
   */
  private selectWordsWithAlgorithm(
    candidates: SearchResult[],
    K: number,
    N: number,
    algorithm: 'N=K' | 'N=K+D',
    usedWords: Set<string>
  ): SearchResult[] {
    // Apply intra-category containment filtering first
    const selectedCandidates = [];
    const categoryWords = new Set<string>();
    
    for (const candidate of candidates) {
      // Check for containment with already selected words in this category
      const hasIntraContainment = Array.from(categoryWords).some(selectedWord => {
        const candidateLower = candidate.word.toLowerCase();
        const selectedLower = selectedWord.toLowerCase();
        return candidateLower.includes(selectedLower) || selectedLower.includes(candidateLower);
      });
      
      if (!hasIntraContainment) {
        selectedCandidates.push(candidate);
        categoryWords.add(candidate.word);
        
        // Algorithm-specific selection logic
        if (algorithm === 'N=K') {
          // Take first K candidates (highest similarity)
          if (selectedCandidates.length === K) {
            break;
          }
        } else if (algorithm === 'N=K+D') {
          // Take up to N candidates, then we'll select K from them
          if (selectedCandidates.length === N) {
            break;
          }
        }
      }
    }
    
    // For N=K+D, discard the D closest (highest similarity) candidates
    if (algorithm === 'N=K+D' && selectedCandidates.length >= K) {
      // Sort by similarity descending, then skip first D candidates
      const sortedCandidates = selectedCandidates.sort((a, b) => b.similarity - a.similarity);
      const D = N - K;
      return sortedCandidates.slice(D, D + K); // Skip D closest, take next K
    }
    
    // For N=K, return up to K candidates
    return selectedCandidates.slice(0, K);
  }

  /**
   * Calculate frequency threshold with custom thresholds support
   */
  private calculateConfigurableFrequencyThreshold(
    difficulty: number, 
    maxDifficulty: number,
    customThresholds?: number[]
  ): number {
    if (customThresholds && customThresholds.length >= difficulty) {
      return customThresholds[difficulty - 1]; // 1-based to 0-based index
    }
    
    // Fall back to original calculation
    return this.calculateFrequencyThresholdPublic(difficulty, maxDifficulty);
  }

  // Public wrappers for private methods (for investigation access)
  public validateCategoryPublic(category: GeneratedCategory, expectedWordCount?: number): boolean {
    return (this as any).validateCategory(category, expectedWordCount);
  }

  public assemblePuzzlePublic(date: string, puzzleNumber: number, categories: GeneratedCategory[]): GeneratedPuzzle {
    return (this as any).assemblePuzzle(date, puzzleNumber, categories);
  }

  public calculatePuzzleQualityPublic(puzzle: GeneratedPuzzle): number {
    return (this as any).calculatePuzzleQuality(puzzle);
  }

  public calculateFrequencyThresholdPublic(difficulty: number, maxDifficulty: number): number {
    return (this as any).calculateFrequencyThreshold(difficulty, maxDifficulty);
  }

  public getRandomSeedWordWithFrequencyPublic(frequencyThreshold: number): string {
    return (this as any).vectorLoader.getRandomSeedWordWithFrequency(frequencyThreshold);
  }

  public async findNearestWithQualityControlsPublic(
    seedWord: string, 
    count: number, 
    usedWords: Set<string>, 
    minWordFrequencyThreshold: number
  ): Promise<SearchResult[]> {
    return await (this as any).vectorLoader.findNearestWithQualityControls(
      seedWord, 
      count, 
      usedWords, 
      minWordFrequencyThreshold
    );
  }
}