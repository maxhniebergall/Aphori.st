/**
 * Gemini Enhanced Puzzle Generator
 * Integrates the data science pipeline's Gemini-based algorithm into the puzzle generation system
 */

import { FullVectorLoader, SearchResult } from './FullVectorLoader.js';
import { UsedThemeWords } from './UsedThemeWords.js';
import { GeneratedCategory, GeneratedPuzzle, GeneratedPuzzleOutput, GenerationResult, DifficultyMetrics } from './HighQualityPuzzleGenerator.js';

export interface GeminiConfig {
  apiKey: string;
  modelId: string;
  embeddingDimension: number;
  taskType: string;
}

export interface WikiThemeConfig {
  categoriesPath: string;
  excludeCategories: string[];
  minThemeLength: number;
}

export interface GeminiEnhancementResult {
  word: string;
  embedding: number[];
  similarityToTheme: number;
}

export interface EnhancedGeneratedCategory extends GeneratedCategory {
  geminiSimilarities?: number[];
  allCandidates?: string[];
  enhancementMethod: 'gemini' | 'local';
}

const MIN_WORD_FREQUENCY_THRESHOLD = 0.05;
const MIN_SIMILARITY_THRESHOLD = 0.62;

export class GeminiEnhancedPuzzleGenerator {
  private usedThemeWords: UsedThemeWords;
  private geminiConfig?: GeminiConfig;
  private wikiThemeConfig?: WikiThemeConfig;
  private isGeminiEnabled: boolean = false;

  constructor(
    private vectorLoader: FullVectorLoader,
    geminiConfig?: GeminiConfig,
    wikiThemeConfig?: WikiThemeConfig
  ) {
    this.usedThemeWords = new UsedThemeWords();
    this.geminiConfig = geminiConfig;
    this.wikiThemeConfig = wikiThemeConfig;
    this.isGeminiEnabled = this.validateGeminiConfig();
    
    if (this.isGeminiEnabled) {
      console.log('🤖 Gemini enhancement enabled');
    } else {
      console.log('🔄 Using local vector similarity (Gemini disabled)');
    }
  }

  /**
   * Validate if Gemini configuration is properly set up
   */
  private validateGeminiConfig(): boolean {
    if (!this.geminiConfig) {
      return false;
    }
    
    const { apiKey, modelId, embeddingDimension } = this.geminiConfig;
    if (!apiKey || !modelId || !embeddingDimension) {
      console.warn('⚠️ Incomplete Gemini configuration, falling back to local similarity');
      return false;
    }
    
    return true;
  }

  /**
   * Generate multiple puzzles for a given date with enhanced algorithm
   */
  async generateDailyPuzzles(date: string, count: number = 7): Promise<GeneratedPuzzleOutput> {
    console.log(`🎯 Generating ${count} enhanced puzzles for ${date}...`);
    
    // Define puzzle configurations for sizes 4x4 through 10x10
    const puzzleConfigs = [
      { size: 4, name: '4x4 Enhanced' },
      { size: 5, name: '5x5 Enhanced' },
      { size: 6, name: '6x6 Enhanced' },
      { size: 7, name: '7x7 Enhanced' },
      { size: 8, name: '8x8 Enhanced' },
      { size: 9, name: '9x9 Enhanced' },
      { size: 10, name: '10x10 Enhanced' }
    ];
    
    const puzzles: GeneratedPuzzle[] = [];
    let totalAttempts = 0;
    const qualityScores: number[] = [];

    for (let i = 0; i < Math.min(count, puzzleConfigs.length); i++) {
      const config = puzzleConfigs[i];
      console.log(`\n🎲 Generating enhanced puzzle ${i + 1}: ${config.name}`);
      
      const result = await this.generateSinglePuzzle(date, i + 1, config.size);
      
      if (result.puzzle) {
        puzzles.push(result.puzzle);
        qualityScores.push(result.qualityScore);
        
        // Log enhancement details
        const enhancementMethods = result.puzzle.categories.map(cat => 
          (cat as EnhancedGeneratedCategory).enhancementMethod || 'local'
        );
        const geminiCount = enhancementMethods.filter(m => m === 'gemini').length;
        const localCount = enhancementMethods.filter(m => m === 'local').length;
        
        console.log(`✅ Puzzle ${i + 1}: Generated in ${result.attempts} attempts`);
        console.log(`   🤖 Enhancement: ${geminiCount} Gemini, ${localCount} local`);
        console.log(`   📊 Quality: ${result.qualityScore.toFixed(2)}`);
      }
      
      totalAttempts += result.attempts;
    }

    return {
      date,
      puzzles,
      metadata: {
        generatedAt: Date.now(),
        generatorVersion: '2.0.0-gemini',
        totalAttempts,
        successRate: puzzles.length / count,
        qualityScore: qualityScores.length > 0 ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : 0,
        difficultyProgression: {
          puzzleSizes: [4, 5, 6, 7, 8, 9, 10],
          categoryDifficulties: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          algorithmUsed: this.isGeminiEnabled ? 'Gemini + Local Hybrid' : 'Local Vector Similarity'
        }
      }
    };
  }

  /**
   * Generate a single puzzle with enhanced algorithm
   */
  private async generateSinglePuzzle(date: string, puzzleNumber: number, puzzleSize: number = 4): Promise<GenerationResult> {
    const maxAttempts = 100;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const categories: EnhancedGeneratedCategory[] = [];
      const usedWords = new Set<string>();

      // Generate categories with progressive difficulty
      for (let catIndex = 0; catIndex < puzzleSize; catIndex++) {
        const category = await this.generateEnhancedCategory(usedWords, catIndex, puzzleSize);
        
        if (category && this.validateCategory(category, puzzleSize)) {
          categories.push(category);
          category.words.forEach(word => usedWords.add(word));
        } else {
          break; // Failed to generate valid category, restart puzzle
        }
      }

      if (categories.length === puzzleSize) {
        const puzzle = this.assemblePuzzle(date, puzzleNumber, categories);
        const qualityScore = this.calculatePuzzleQuality(puzzle);
        
        if (qualityScore >= 0.5) {
          return {
            puzzle,
            qualityScore,
            attempts: attempt
          };
        }
      }
    }

    console.log(`❌ Failed to generate enhanced puzzle ${puzzleNumber} after ${maxAttempts} attempts`);
    return {
      puzzle: null,
      qualityScore: 0,
      attempts: maxAttempts
    };
  }

  /**
   * Generate a category with Gemini enhancement if available, fallback to local
   */
  private async generateEnhancedCategory(
    usedWords: Set<string>, 
    categoryIndex: number, 
    puzzleSize: number = 4
  ): Promise<EnhancedGeneratedCategory | null> {
    const maxAttempts = 20;
    const K = puzzleSize;
    const D = categoryIndex + 1;
    
    console.log(`🎯 Generating enhanced category ${categoryIndex + 1}: K=${K}, D=${D}`);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Select theme word based on difficulty
        const themeWord = await this.selectThemeWord(D, puzzleSize, usedWords);
        if (!themeWord || usedWords.has(themeWord) || this.usedThemeWords.isWordUsed(themeWord)) {
          continue;
        }

        // Get initial candidates using local vector search
        const initialCandidates = await this.vectorLoader.findNearestWithQualityControls(
          themeWord, 
          K + 10, // Get extra candidates for filtering
          usedWords, 
          MIN_WORD_FREQUENCY_THRESHOLD
        );

        if (initialCandidates.length < K) {
          continue;
        }

        // Enhance with Gemini if available
        let finalCandidates: SearchResult[];
        let enhancementMethod: 'gemini' | 'local' = 'local';
        let geminiSimilarities: number[] | undefined;
        let allCandidates: string[] | undefined;

        if (this.isGeminiEnabled) {
          try {
            const enhanced = await this.enhanceWithGemini(themeWord, initialCandidates);
            if (enhanced && enhanced.length >= K) {
              // Convert Gemini results back to SearchResult format
              finalCandidates = enhanced.slice(0, K).map(result => ({
                word: result.word,
                similarity: result.similarityToTheme
              }));
              enhancementMethod = 'gemini';
              geminiSimilarities = enhanced.map(r => r.similarityToTheme);
              allCandidates = enhanced.map(r => r.word);
            } else {
              finalCandidates = initialCandidates.slice(0, K);
            }
          } catch (error) {
            console.warn(`⚠️ Gemini enhancement failed for "${themeWord}": ${error}. Using local similarity.`);
            finalCandidates = initialCandidates.slice(0, K);
          }
        } else {
          finalCandidates = initialCandidates.slice(0, K);
        }

        // Apply containment filtering
        const filteredCandidates = this.filterContainment(finalCandidates, K);
        
        if (filteredCandidates.length < K) {
          console.log(`   ⚠️ Could only find ${filteredCandidates.length}/${K} words without containment`);
          continue;
        }

        const selectedWords = filteredCandidates.map(c => c.word);
        const minSimilarity = Math.min(...filteredCandidates.map(c => c.similarity));

        if (minSimilarity < MIN_SIMILARITY_THRESHOLD) {
          console.log(`   ❌ Similarity ${minSimilarity.toFixed(3)} below threshold`);
          this.usedThemeWords.markWordAsUsed(themeWord, undefined, `generation_${Date.now()}`, minSimilarity, true);
          continue;
        }

        console.log(`   ✅ Category ${categoryIndex + 1}: ${enhancementMethod} enhancement, similarity: ${minSimilarity.toFixed(3)}`);
        console.log(`   🎲 Theme: "${themeWord}" → Words: [${selectedWords.join(', ')}]`);

        // Mark theme word as successfully used
        this.usedThemeWords.markWordAsUsed(themeWord, undefined, `generation_${Date.now()}`, minSimilarity, false);

        return {
          id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          themeWord: themeWord,
          words: selectedWords,
          difficulty: D,
          similarity: minSimilarity,
          difficultyMetrics: {
            totalNeighbors: K,
            selectedRange: `1-${K} (enhanced neighbors)`
          },
          enhancementMethod,
          geminiSimilarities,
          allCandidates
        };

      } catch (error) {
        console.error(`   ❌ Error in enhanced category generation attempt ${attempt + 1}:`, error);
      }
    }

    console.log(`   ❌ Failed to generate enhanced category ${categoryIndex + 1}`);
    return null;
  }

  /**
   * Select theme word based on difficulty and available sources
   */
  private async selectThemeWord(difficulty: number, maxDifficulty: number, usedWords: Set<string>): Promise<string | null> {
    // If we have Wiki themes configured, use those for variety
    if (this.wikiThemeConfig && Math.random() < 0.3) { // 30% chance to use Wiki themes
      return this.selectWikiTheme();
    }
    
    // Otherwise use frequency-based selection like the original algorithm
    const frequencyThreshold = this.calculateFrequencyThreshold(difficulty, maxDifficulty);
    return this.vectorLoader.getRandomSeedWordWithFrequency(frequencyThreshold);
  }

  /**
   * Select a theme from Wikipedia categories if configured
   */
  private selectWikiTheme(): string | null {
    // This would need to load the Wikipedia categories file
    // For now, return null to fall back to frequency-based selection
    return null;
  }

  /**
   * Calculate frequency threshold (same as original algorithm)
   */
  private calculateFrequencyThreshold(difficulty: number, maxDifficulty: number): number {
    const minThreshold = 1000;
    const maxThreshold = 1000000;
    
    if (difficulty === 1) {
      return maxThreshold;
    } else if (difficulty === 2) {
      return 100000;
    } else if (difficulty === 3) {
      return 10000;
    } else {
      const ratio = Math.max(0, (difficulty - 3) / Math.max(1, maxDifficulty - 3));
      const threshold = 10000 - (ratio * (10000 - minThreshold));
      return Math.max(minThreshold, threshold);
    }
  }

  /**
   * Enhance candidates using Gemini API (placeholder - would need actual implementation)
   */
  private async enhanceWithGemini(themeWord: string, candidates: SearchResult[]): Promise<GeminiEnhancementResult[] | null> {
    if (!this.geminiConfig) {
      return null;
    }

    // This is a placeholder for the actual Gemini API integration
    // In a real implementation, this would:
    // 1. Generate embeddings for theme word and candidates using Gemini API
    // 2. Calculate cosine similarities
    // 3. Return results sorted by similarity
    
    console.log(`🤖 [PLACEHOLDER] Gemini enhancement for "${themeWord}" with ${candidates.length} candidates`);
    
    // For now, return null to fall back to local similarity
    // TODO: Implement actual Gemini API calls similar to the Python pipeline
    return null;
  }

  /**
   * Filter out words with containment issues
   */
  private filterContainment(candidates: SearchResult[], targetCount: number): SearchResult[] {
    const filtered: SearchResult[] = [];
    const usedWords = new Set<string>();
    
    for (const candidate of candidates) {
      const hasContainment = Array.from(usedWords).some(usedWord => {
        const candidateLower = candidate.word.toLowerCase();
        const usedLower = usedWord.toLowerCase();
        return candidateLower.includes(usedLower) || usedLower.includes(candidateLower);
      });
      
      if (!hasContainment) {
        filtered.push(candidate);
        usedWords.add(candidate.word);
        
        if (filtered.length === targetCount) {
          break;
        }
      }
    }
    
    return filtered;
  }

  /**
   * Validate a generated category
   */
  private validateCategory(category: GeneratedCategory, expectedWordCount?: number): boolean {
    const expectedCount = expectedWordCount || category.words.length;
    if (category.words.length !== expectedCount) {
      return false;
    }

    const uniqueWords = new Set(category.words);
    if (uniqueWords.size !== category.words.length) {
      return false;
    }

    if (category.similarity < MIN_SIMILARITY_THRESHOLD) {
      return false;
    }

    for (const word of category.words) {
      if (!word || typeof word !== 'string' || word.length < 2) {
        return false;
      }
    }

    return true;
  }

  /**
   * Assemble final puzzle from categories
   */
  private assemblePuzzle(date: string, puzzleNumber: number, categories: EnhancedGeneratedCategory[]): GeneratedPuzzle {
    const allWords = categories.flatMap(cat => cat.words);
    
    return {
      id: `enhanced_${date}_${puzzleNumber}`,
      date,
      puzzleNumber,
      gridSize: categories.length,
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
    const avgDifficulty = categories.reduce((sum, cat) => sum + cat.difficulty, 0) / categories.length;
    const avgSimilarity = categories.reduce((sum, cat) => sum + cat.similarity, 0) / categories.length;
    const similarityAdjustment = (1 - avgSimilarity) * 2;
    const finalDifficulty = avgDifficulty + similarityAdjustment;
    
    return Math.max(1, Math.min(10, Math.round(finalDifficulty)));
  }

  /**
   * Calculate simple quality score
   */
  private calculateSimpleQuality(categories: GeneratedCategory[]): number {
    const avgSimilarity = categories.reduce((sum, cat) => sum + cat.similarity, 0) / categories.length;
    return Math.max(0.3, Math.min(1, avgSimilarity));
  }

  /**
   * Calculate overall puzzle quality
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
    const lengths = words.map(word => word.length);
    const uniqueLengths = new Set(lengths);
    const lengthDiversity = uniqueLengths.size / lengths.length;
    
    const allLetters = words.join('').split('');
    const uniqueLetters = new Set(allLetters);
    const letterDiversity = Math.min(1, uniqueLetters.size / 15);
    
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