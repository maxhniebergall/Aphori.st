/**
 * Themes Quality Control Service
 * Provides comprehensive validation and scoring for words, categories, and puzzles
 */

import { 
  WordQualityMetrics, 
  CategoryQualityMetrics, 
  PuzzleQualityMetrics,
  QualityControlConfig,
  QUALITY_CONTROL_CONFIG,
  ThemesCategory,
  ThemesPuzzle
} from '../../types/games/themes.js';
import { ThemesVectorService } from './ThemesVectorService.js';
import logger from '../../logger.js';

export interface QualityValidationResult {
  valid: boolean;
  score: number;
  issues: string[];
  metrics: WordQualityMetrics | CategoryQualityMetrics | PuzzleQualityMetrics;
}

export class ThemesQualityControl {
  private config: QualityControlConfig;
  private vectorService: ThemesVectorService | null;

  constructor(vectorService?: ThemesVectorService, config?: Partial<QualityControlConfig>) {
    this.vectorService = vectorService || null;
    this.config = { ...QUALITY_CONTROL_CONFIG, ...config };
  }

  /**
   * Validate and score a single word for use in themes game
   */
  async validateWord(word: string): Promise<QualityValidationResult> {
    const issues: string[] = [];
    const metrics = await this.calculateWordQualityMetrics(word);
    
    // Check appropriateness
    if (metrics.appropriateness < this.config.minWordAppropriateness) {
      issues.push(`Word "${word}" has low appropriateness score: ${metrics.appropriateness.toFixed(2)}`);
    }
    
    // Check commonality
    if (metrics.commonality < this.config.minWordCommonality) {
      issues.push(`Word "${word}" is too obscure: ${metrics.commonality.toFixed(2)}`);
    }
    
    // Check difficulty
    if (metrics.difficulty > this.config.maxWordDifficulty) {
      issues.push(`Word "${word}" is too difficult: ${metrics.difficulty}`);
    }
    
    // Check semantic clarity
    if (metrics.semanticClarity < this.config.minWordSemanticClarity) {
      issues.push(`Word "${word}" has unclear meaning: ${metrics.semanticClarity.toFixed(2)}`);
    }
    
    // Check overall score
    if (metrics.overallScore < this.config.minWordOverallScore) {
      issues.push(`Word "${word}" has low overall quality: ${metrics.overallScore.toFixed(2)}`);
    }

    return {
      valid: issues.length === 0,
      score: metrics.overallScore,
      issues,
      metrics
    };
  }

  /**
   * Validate and score a category for use in themes game
   */
  async validateCategory(category: ThemesCategory): Promise<QualityValidationResult> {
    const issues: string[] = [];
    const metrics = await this.calculateCategoryQualityMetrics(category);
    
    // Check internal cohesion
    if (metrics.internalCohesion < this.config.minCategoryInternalCohesion) {
      issues.push(`Category "${category.themeWord}" has low internal cohesion: ${metrics.internalCohesion.toFixed(2)}`);
    }
    
    // Check semantic clarity
    if (metrics.semanticClarity < this.config.minCategorySemanticClarity) {
      issues.push(`Category "${category.themeWord}" theme is unclear: ${metrics.semanticClarity.toFixed(2)}`);
    }
    
    // Check word quality
    if (metrics.wordQuality < this.config.minCategoryWordQuality) {
      issues.push(`Category "${category.themeWord}" has low word quality: ${metrics.wordQuality.toFixed(2)}`);
    }
    
    // Check appropriateness
    if (metrics.appropriateness < this.config.minCategoryAppropriateness) {
      issues.push(`Category "${category.themeWord}" has inappropriate content: ${metrics.appropriateness.toFixed(2)}`);
    }
    
    // Check difficulty
    if (metrics.difficulty > this.config.maxCategoryDifficulty) {
      issues.push(`Category "${category.themeWord}" is too difficult: ${metrics.difficulty}`);
    }
    
    // Check overall score
    if (metrics.overallScore < this.config.minCategoryOverallScore) {
      issues.push(`Category "${category.themeWord}" has low overall quality: ${metrics.overallScore.toFixed(2)}`);
    }

    return {
      valid: issues.length === 0,
      score: metrics.overallScore,
      issues,
      metrics
    };
  }

  /**
   * Validate and score a complete puzzle
   */
  async validatePuzzle(puzzle: ThemesPuzzle): Promise<QualityValidationResult> {
    const issues: string[] = [];
    const metrics = await this.calculatePuzzleQualityMetrics(puzzle);
    
    // Check category quality
    if (metrics.categoryQuality < this.config.minPuzzleCategoryQuality) {
      issues.push(`Puzzle has low category quality: ${metrics.categoryQuality.toFixed(2)}`);
    }
    
    // Check cross-category diversity
    if (metrics.crossCategoryDiversity < this.config.minCrossCategoryDiversity) {
      issues.push(`Puzzle categories are too similar: ${metrics.crossCategoryDiversity.toFixed(2)}`);
    }
    
    // Check difficulty progression
    if (metrics.difficultyProgression < this.config.minDifficultyProgression) {
      issues.push(`Puzzle has poor difficulty progression: ${metrics.difficultyProgression.toFixed(2)}`);
    }
    
    // Check word diversity
    if (metrics.wordDiversity < this.config.minWordDiversity) {
      issues.push(`Puzzle has low word diversity: ${metrics.wordDiversity.toFixed(2)}`);
    }
    
    // Check appropriateness
    if (metrics.appropriateness < this.config.minPuzzleAppropriateness) {
      issues.push(`Puzzle has inappropriate content: ${metrics.appropriateness.toFixed(2)}`);
    }
    
    // Check overall score
    if (metrics.overallScore < this.config.minPuzzleOverallScore) {
      issues.push(`Puzzle has low overall quality: ${metrics.overallScore.toFixed(2)}`);
    }

    return {
      valid: issues.length === 0,
      score: metrics.overallScore,
      issues,
      metrics
    };
  }

  /**
   * Check if categories have sufficient diversity (not too similar to each other)
   */
  async validateCategoryDiversity(categories: ThemesCategory[]): Promise<{
    valid: boolean;
    conflicts: Array<{ category1: string; category2: string; similarity: number }>;
  }> {
    const conflicts: Array<{ category1: string; category2: string; similarity: number }> = [];
    
    if (!this.vectorService) {
      logger.warn('Vector service not available for category diversity validation');
      return { valid: true, conflicts: [] };
    }

    // Check pairwise similarity between category theme words
    for (let i = 0; i < categories.length; i++) {
      for (let j = i + 1; j < categories.length; j++) {
        const cat1 = categories[i];
        const cat2 = categories[j];
        
        try {
          // Calculate similarity between theme words
          const similarity = await this.calculateCategorySimilarity(cat1, cat2);
          
          if (similarity > this.config.maxCategorySimilarity) {
            conflicts.push({
              category1: cat1.themeWord,
              category2: cat2.themeWord,
              similarity
            });
          }
        } catch (error) {
          logger.warn(`Failed to calculate similarity between ${cat1.themeWord} and ${cat2.themeWord}:`, error);
        }
      }
    }

    return {
      valid: conflicts.length === 0,
      conflicts
    };
  }

  /**
   * Filter words by quality threshold
   */
  async filterWordsByQuality(words: string[], minScore: number = 0.6): Promise<{
    accepted: string[];
    rejected: Array<{ word: string; score: number; issues: string[] }>;
  }> {
    const accepted: string[] = [];
    const rejected: Array<{ word: string; score: number; issues: string[] }> = [];

    for (const word of words) {
      const validation = await this.validateWord(word);
      
      if (validation.valid && validation.score >= minScore) {
        accepted.push(word);
      } else {
        rejected.push({
          word,
          score: validation.score,
          issues: validation.issues
        });
      }
    }

    return { accepted, rejected };
  }

  /**
   * Calculate word quality metrics
   */
  private async calculateWordQualityMetrics(word: string): Promise<WordQualityMetrics> {
    const appropriateness = this.calculateWordAppropriateness(word);
    const commonality = this.estimateWordCommonality(word);
    const difficulty = this.estimateWordDifficulty(word);
    const semanticClarity = this.estimateSemanticClarity(word);
    
    // Weighted overall score
    const overallScore = (
      appropriateness * 0.3 +
      commonality * 0.2 +
      (1 - (difficulty - 1) / 9) * 0.2 + // Normalize difficulty to 0-1 where lower is better
      semanticClarity * 0.3
    );

    return {
      appropriateness,
      commonality,
      difficulty,
      semanticClarity,
      overallScore: Math.max(0, Math.min(1, overallScore))
    };
  }

  /**
   * Calculate category quality metrics
   */
  private async calculateCategoryQualityMetrics(category: ThemesCategory): Promise<CategoryQualityMetrics> {
    // Calculate individual word quality
    const wordQualities = await Promise.all(
      category.words.map(word => this.calculateWordQualityMetrics(word))
    );
    
    const internalCohesion = category.similarity; // Use existing similarity score
    const semanticClarity = this.estimateCategorySemanticClarity(category);
    const wordQuality = wordQualities.reduce((sum, wq) => sum + wq.overallScore, 0) / wordQualities.length;
    const appropriateness = Math.min(...wordQualities.map(wq => wq.appropriateness));
    const difficulty = Math.max(...wordQualities.map(wq => wq.difficulty));
    
    // Weighted overall score
    const overallScore = (
      internalCohesion * 0.3 +
      semanticClarity * 0.2 +
      wordQuality * 0.3 +
      appropriateness * 0.2
    );

    return {
      internalCohesion,
      semanticClarity,
      wordQuality,
      appropriateness,
      difficulty,
      overallScore: Math.max(0, Math.min(1, overallScore))
    };
  }

  /**
   * Calculate puzzle quality metrics
   */
  private async calculatePuzzleQualityMetrics(puzzle: ThemesPuzzle): Promise<PuzzleQualityMetrics> {
    // Calculate category qualities
    const categoryQualities = await Promise.all(
      puzzle.categories.map(cat => this.calculateCategoryQualityMetrics(cat))
    );
    
    const categoryQuality = categoryQualities.reduce((sum, cq) => sum + cq.overallScore, 0) / categoryQualities.length;
    const crossCategoryDiversity = await this.calculateCrossCategoryDiversity(puzzle.categories);
    const difficultyProgression = this.calculateDifficultyProgression(puzzle.categories);
    const wordDiversity = this.calculateWordDiversity(puzzle.words);
    const appropriateness = Math.min(...categoryQualities.map(cq => cq.appropriateness));
    
    // Weighted overall score
    const overallScore = (
      categoryQuality * 0.4 +
      crossCategoryDiversity * 0.2 +
      difficultyProgression * 0.1 +
      wordDiversity * 0.1 +
      appropriateness * 0.2
    );

    return {
      categoryQuality,
      crossCategoryDiversity,
      difficultyProgression,
      wordDiversity,
      appropriateness,
      overallScore: Math.max(0, Math.min(1, overallScore))
    };
  }

  /**
   * Calculate word appropriateness (content filtering)
   */
  private calculateWordAppropriateness(word: string): number {
    const lowerWord = word.toLowerCase();
    
    // Check excluded words (exact matches)
    if (this.config.excludedWords.includes(lowerWord)) {
      return 0;
    }
    
    // Check for partial matches with excluded words (only for longer words)
    if (lowerWord.length > 3) {
      for (const excluded of this.config.excludedWords) {
        if (excluded.length > 3 && (lowerWord.includes(excluded) || excluded.includes(lowerWord))) {
          return 0.3; // Partial match penalty
        }
      }
    }
    
    // Check for potentially problematic patterns
    if (this.hasProblematicPatterns(lowerWord)) {
      return 0.5;
    }
    
    return 1.0; // Appropriate
  }

  /**
   * Estimate word commonality (how well-known it is)
   */
  private estimateWordCommonality(word: string): number {
    const length = word.length;
    
    // Very basic heuristic - shorter words tend to be more common
    if (length <= 4) return 0.9;
    if (length <= 6) return 0.7;
    if (length <= 8) return 0.5;
    if (length <= 10) return 0.3;
    return 0.1;
  }

  /**
   * Estimate word difficulty (1-10 scale)
   */
  private estimateWordDifficulty(word: string): number {
    const length = word.length;
    let difficulty = 1;
    
    // Length-based difficulty
    if (length <= 4) difficulty = 2;
    else if (length <= 6) difficulty = 4;
    else if (length <= 8) difficulty = 6;
    else if (length <= 10) difficulty = 8;
    else difficulty = 10;
    
    // Adjust for complexity patterns
    if (this.hasComplexPatterns(word)) {
      difficulty = Math.min(10, difficulty + 2);
    }
    
    return difficulty;
  }

  /**
   * Estimate semantic clarity (how clear the meaning is)
   */
  private estimateSemanticClarity(word: string): number {
    // Basic heuristics for semantic clarity
    let clarity = 0.7; // Default moderate clarity
    
    // Concrete nouns tend to be clearer
    if (this.likelyConcreteNoun(word)) {
      clarity += 0.2;
    }
    
    // Abstract or ambiguous words are less clear
    if (this.likelyAbstractWord(word)) {
      clarity -= 0.3;
    }
    
    return Math.max(0, Math.min(1, clarity));
  }

  /**
   * Estimate category semantic clarity
   */
  private estimateCategorySemanticClarity(category: ThemesCategory): number {
    // Check if the theme word clearly relates to the category words
    const themeClarity = this.estimateSemanticClarity(category.themeWord);
    const avgWordClarity = category.words.reduce(
      (sum, word) => sum + this.estimateSemanticClarity(word), 0
    ) / category.words.length;
    
    // Higher similarity suggests clearer theme
    const similarityBonus = Math.min(0.3, category.similarity);
    
    return Math.max(0, Math.min(1, (themeClarity + avgWordClarity) / 2 + similarityBonus));
  }

  /**
   * Calculate cross-category diversity
   */
  private async calculateCrossCategoryDiversity(categories: ThemesCategory[]): Promise<number> {
    if (!this.vectorService || categories.length < 2) {
      return 1.0; // Assume good diversity if can't calculate
    }

    let totalSimilarity = 0;
    let comparisons = 0;

    // Calculate average similarity between all category pairs
    for (let i = 0; i < categories.length; i++) {
      for (let j = i + 1; j < categories.length; j++) {
        try {
          const similarity = await this.calculateCategorySimilarity(categories[i], categories[j]);
          totalSimilarity += similarity;
          comparisons++;
        } catch (error) {
          logger.warn('Failed to calculate category similarity:', error);
        }
      }
    }

    if (comparisons === 0) return 1.0;

    const avgSimilarity = totalSimilarity / comparisons;
    return Math.max(0, Math.min(1, 1 - avgSimilarity)); // Diversity is inverse of similarity
  }

  /**
   * Calculate similarity between two categories
   */
  private async calculateCategorySimilarity(cat1: ThemesCategory, cat2: ThemesCategory): Promise<number> {
    if (!this.vectorService) {
      throw new Error('Vector service not available');
    }

    try {
      // Use theme words for primary similarity
      const themeResults = await this.vectorService.findSimilarWords(cat1.themeWord, 50);
      const cat2ThemeMatch = themeResults.find(result => result.word === cat2.themeWord);
      
      if (cat2ThemeMatch) {
        return cat2ThemeMatch.similarity;
      }

      // Fallback: calculate average similarity between category words
      let totalSimilarity = 0;
      let validComparisons = 0;

      for (const word1 of cat1.words) {
        const wordResults = await this.vectorService.findSimilarWords(word1, 20);
        
        for (const word2 of cat2.words) {
          const match = wordResults.find(result => result.word === word2);
          if (match) {
            totalSimilarity += match.similarity;
            validComparisons++;
          }
        }
      }

      return validComparisons > 0 ? totalSimilarity / validComparisons : 0;
    } catch (error) {
      logger.warn(`Failed to calculate category similarity: ${error}`);
      return 0;
    }
  }

  /**
   * Calculate difficulty progression quality
   */
  private calculateDifficultyProgression(categories: ThemesCategory[]): number {
    if (categories.length < 2) return 1.0;

    // Check if similarities decrease (indicating increasing difficulty)
    const similarities = categories.map(cat => cat.similarity);
    let progressionScore = 0;

    for (let i = 1; i < similarities.length; i++) {
      if (similarities[i] <= similarities[i - 1]) {
        progressionScore += 1;
      }
    }

    return progressionScore / (similarities.length - 1);
  }

  /**
   * Calculate word diversity in puzzle
   */
  private calculateWordDiversity(words: string[]): number {
    if (words.length === 0) return 0;

    // Length diversity
    const lengths = words.map(word => word.length);
    const uniqueLengths = new Set(lengths);
    const lengthDiversity = uniqueLengths.size / Math.min(lengths.length, 6); // Normalize to reasonable max

    // Letter diversity
    const allLetters = words.join('').split('');
    const uniqueLetters = new Set(allLetters);
    const letterDiversity = Math.min(1, uniqueLetters.size / 20); // Normalize to expected letter count

    // Starting letter diversity
    const startingLetters = words.map(word => word[0].toLowerCase());
    const uniqueStartingLetters = new Set(startingLetters);
    const startingLetterDiversity = uniqueStartingLetters.size / words.length;

    return (lengthDiversity + letterDiversity + startingLetterDiversity) / 3;
  }

  /**
   * Check for problematic patterns in words
   */
  private hasProblematicPatterns(word: string): boolean {
    // Check for repeated characters that might be gibberish
    if (/(.)\1{2,}/.test(word)) return true;
    
    // Check for excessive consonants
    if (word.replace(/[aeiou]/g, '').length / word.length > 0.8) return true;
    
    // Check for very long words without vowels
    if (word.length > 6 && !/[aeiou]/.test(word)) return true;
    
    return false;
  }

  /**
   * Check for complex patterns that increase difficulty
   */
  private hasComplexPatterns(word: string): boolean {
    // Double letters
    if (/(.)\1/.test(word)) return true;
    
    // Silent letters patterns
    if (/^kn|^wr|^gn|mb$|ght/.test(word)) return true;
    
    // Uncommon letter combinations
    if (/qu|x|z|j/.test(word)) return true;
    
    return false;
  }

  /**
   * Check if word is likely a concrete noun
   */
  private likelyConcreteNoun(word: string): boolean {
    // Very basic pattern matching for concrete nouns
    // In a full implementation, this would use NLP libraries
    const concretePatterns = [
      /^(cat|dog|car|house|tree|book|table|chair)$/,
      /(tion|sion|ment|ness)$/, // Abstract noun endings (negative indicator)
    ];
    
    // If it matches concrete examples, it's likely concrete
    if (concretePatterns[0].test(word)) return true;
    
    // If it has abstract endings, it's likely abstract
    if (concretePatterns[1].test(word)) return false;
    
    // Default assumption for other words
    return word.length <= 8; // Shorter words tend to be more concrete
  }

  /**
   * Check if word is likely abstract
   */
  private likelyAbstractWord(word: string): boolean {
    const abstractPatterns = [
      /(tion|sion|ment|ness|ity|ism|dom|ship|hood)$/,
      /^(idea|concept|thought|feeling|emotion|love|hate|beauty|truth)$/
    ];
    
    return abstractPatterns.some(pattern => pattern.test(word));
  }
}