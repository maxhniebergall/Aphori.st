#!/usr/bin/env node

/**
 * Batch Quality Validator
 * Validates that generated puzzle batches meet 4x4 requirements and quality standards
 */

import fs from 'fs/promises';
import path from 'path';

export interface PuzzleValidationResult {
  isValid: boolean;
  puzzleId: string;
  gridSize: number;
  categoryCount: number;
  wordsPerCategory: number[];
  totalWords: number;
  issues: string[];
}

export interface BatchValidationResult {
  batchPath: string;
  algorithm: string;
  totalPuzzles: number;
  validPuzzles: number;
  invalidPuzzles: number;
  validationRate: number;
  issues: {
    gridSizeIssues: number;
    categoryCountIssues: number;
    wordCountIssues: number;
    otherIssues: number;
  };
  puzzleResults: PuzzleValidationResult[];
  qualityMetrics: {
    avgSimilarity: number;
    avgQualityScore: number;
    themeCoherence: number;
  };
}

class BatchQualityValidator {
  /**
   * Validate a batch of puzzles for 4x4 requirements
   */
  async validateBatch(batchPath: string): Promise<BatchValidationResult> {
    console.log(`🔍 Validating batch: ${batchPath}`);
    
    const summaryPath = path.join(batchPath, 'summary.json');
    const puzzlesPath = path.join(batchPath, 'puzzles.json');
    
    // Read summary to identify algorithm
    let algorithm = 'unknown';
    try {
      const summaryData = await fs.readFile(summaryPath, 'utf-8');
      const summary = JSON.parse(summaryData);
      algorithm = summary.algorithm || 'unknown';
    } catch (error) {
      console.warn(`⚠️  Could not read summary file: ${error}`);
    }
    
    // Read puzzles file
    const puzzlesData = await fs.readFile(puzzlesPath, 'utf-8');
    const puzzles = JSON.parse(puzzlesData);
    
    // Handle different puzzle formats
    const puzzleList = this.extractPuzzleList(puzzles);
    
    console.log(`📊 Found ${puzzleList.length} puzzles to validate`);
    
    // Validate each puzzle
    const puzzleResults: PuzzleValidationResult[] = [];
    let validCount = 0;
    let gridSizeIssues = 0;
    let categoryCountIssues = 0;
    let wordCountIssues = 0;
    let otherIssues = 0;
    
    for (const puzzle of puzzleList) {
      const validation = this.validateSinglePuzzle(puzzle);
      puzzleResults.push(validation);
      
      if (validation.isValid) {
        validCount++;
      } else {
        // Count issue types
        for (const issue of validation.issues) {
          if (issue.includes('grid size') || issue.includes('16 words')) {
            gridSizeIssues++;
          } else if (issue.includes('categories') || issue.includes('4 categories')) {
            categoryCountIssues++;
          } else if (issue.includes('words per category')) {
            wordCountIssues++;
          } else {
            otherIssues++;
          }
        }
      }
    }
    
    // Calculate quality metrics
    const qualityMetrics = this.calculateQualityMetrics(puzzleList);
    
    const result: BatchValidationResult = {
      batchPath,
      algorithm,
      totalPuzzles: puzzleList.length,
      validPuzzles: validCount,
      invalidPuzzles: puzzleList.length - validCount,
      validationRate: puzzleList.length > 0 ? validCount / puzzleList.length : 0,
      issues: {
        gridSizeIssues,
        categoryCountIssues,
        wordCountIssues,
        otherIssues
      },
      puzzleResults,
      qualityMetrics
    };
    
    console.log(`✅ Validation complete: ${validCount}/${puzzleList.length} puzzles valid (${(result.validationRate * 100).toFixed(1)}%)`);
    
    return result;
  }

  /**
   * Extract puzzle list from different data formats
   */
  private extractPuzzleList(puzzlesData: any): any[] {
    // Handle different formats
    if (Array.isArray(puzzlesData)) {
      return puzzlesData;
    }
    
    if (puzzlesData.puzzles && Array.isArray(puzzlesData.puzzles)) {
      return puzzlesData.puzzles;
    }
    
    // Handle data science pipeline format (themes as keys)
    if (typeof puzzlesData === 'object' && !Array.isArray(puzzlesData)) {
      return Object.values(puzzlesData);
    }
    
    throw new Error('Unknown puzzle data format');
  }

  /**
   * Validate a single puzzle for 4x4 requirements
   */
  private validateSinglePuzzle(puzzle: any): PuzzleValidationResult {
    const issues: string[] = [];
    const puzzleId = puzzle.id || puzzle.theme || 'unknown';
    
    // Extract words and categories
    let words: string[] = [];
    let categories: any[] = [];
    
    if (puzzle.words && Array.isArray(puzzle.words)) {
      words = puzzle.words;
    }
    
    if (puzzle.categories && Array.isArray(puzzle.categories)) {
      categories = puzzle.categories;
    } else if (puzzle.theme && puzzle.words) {
      // Simple format - just one category
      categories = [{
        theme: puzzle.theme,
        words: puzzle.words
      }];
    }
    
    // Validate total word count (should be 16 for 4x4)
    if (words.length !== 16) {
      issues.push(`Expected 16 words for 4x4 grid, found ${words.length}`);
    }
    
    // Validate category count (should be 4 for 4x4)
    if (categories.length !== 4) {
      issues.push(`Expected 4 categories for 4x4 grid, found ${categories.length}`);
    }
    
    // Validate words per category (should be 4 each)
    const wordsPerCategory: number[] = [];
    for (const category of categories) {
      if (category.words && Array.isArray(category.words)) {
        wordsPerCategory.push(category.words.length);
        if (category.words.length !== 4) {
          issues.push(`Category "${category.themeWord || category.theme}" has ${category.words.length} words, expected 4`);
        }
      } else {
        wordsPerCategory.push(0);
        issues.push(`Category "${category.themeWord || category.theme}" has no words array`);
      }
    }
    
    // Check for word uniqueness
    const uniqueWords = new Set(words);
    if (uniqueWords.size !== words.length) {
      issues.push(`Found duplicate words: ${words.length} total, ${uniqueWords.size} unique`);
    }
    
    // Check for empty words
    const emptyWords = words.filter(word => !word || word.trim() === '');
    if (emptyWords.length > 0) {
      issues.push(`Found ${emptyWords.length} empty words`);
    }
    
    return {
      isValid: issues.length === 0,
      puzzleId,
      gridSize: Math.sqrt(words.length),
      categoryCount: categories.length,
      wordsPerCategory,
      totalWords: words.length,
      issues
    };
  }

  /**
   * Calculate quality metrics for the batch
   */
  private calculateQualityMetrics(puzzles: any[]): {
    avgSimilarity: number;
    avgQualityScore: number;
    themeCoherence: number;
  } {
    let totalSimilarity = 0;
    let totalQuality = 0;
    let validScores = 0;
    
    for (const puzzle of puzzles) {
      // Check for similarity scores
      if (puzzle.average_similarity || puzzle.avgSimilarity) {
        totalSimilarity += puzzle.average_similarity || puzzle.avgSimilarity;
        validScores++;
      }
      
      // Check for quality scores
      if (puzzle.metadata?.qualityScore) {
        totalQuality += puzzle.metadata.qualityScore;
      } else if (puzzle.qualityScore) {
        totalQuality += puzzle.qualityScore;
      }
    }
    
    return {
      avgSimilarity: validScores > 0 ? totalSimilarity / validScores : 0,
      avgQualityScore: puzzles.length > 0 ? totalQuality / puzzles.length : 0,
      themeCoherence: validScores > 0 ? totalSimilarity / validScores : 0 // Using similarity as proxy
    };
  }

  /**
   * Generate detailed validation report
   */
  async generateValidationReport(
    wikiValidation: BatchValidationResult,
    geminiValidation: BatchValidationResult,
    outputPath: string
  ): Promise<void> {
    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalBatches: 2,
        totalPuzzles: wikiValidation.totalPuzzles + geminiValidation.totalPuzzles,
        totalValidPuzzles: wikiValidation.validPuzzles + geminiValidation.validPuzzles,
        overallValidationRate: (wikiValidation.validPuzzles + geminiValidation.validPuzzles) / 
                               (wikiValidation.totalPuzzles + geminiValidation.totalPuzzles),
        target: {
          expectedPuzzlesPerBatch: 100,
          expectedTotalPuzzles: 200,
          expectedGridSize: '4x4',
          expectedCategoriesPerPuzzle: 4,
          expectedWordsPerCategory: 4
        }
      },
      batchResults: {
        wikiPipeline: wikiValidation,
        geminiPipeline: geminiValidation
      },
      comparison: {
        betterValidationRate: wikiValidation.validationRate > geminiValidation.validationRate ? 'wiki' : 'gemini',
        validationRateDifference: Math.abs(wikiValidation.validationRate - geminiValidation.validationRate),
        betterQuality: wikiValidation.qualityMetrics.avgQualityScore > geminiValidation.qualityMetrics.avgQualityScore ? 'wiki' : 'gemini',
        qualityDifference: Math.abs(wikiValidation.qualityMetrics.avgQualityScore - geminiValidation.qualityMetrics.avgQualityScore)
      },
      recommendations: this.generateRecommendations(wikiValidation, geminiValidation)
    };
    
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
    console.log(`📋 Validation report saved to: ${outputPath}`);
  }

  /**
   * Generate recommendations based on validation results
   */
  private generateRecommendations(
    wikiValidation: BatchValidationResult,
    geminiValidation: BatchValidationResult
  ): string[] {
    const recommendations: string[] = [];
    
    if (wikiValidation.validationRate < 0.9) {
      recommendations.push(`Wiki pipeline has low validation rate (${(wikiValidation.validationRate * 100).toFixed(1)}%) - review algorithm parameters`);
    }
    
    if (geminiValidation.validationRate < 0.9) {
      recommendations.push(`Gemini pipeline has low validation rate (${(geminiValidation.validationRate * 100).toFixed(1)}%) - review API configuration`);
    }
    
    if (wikiValidation.issues.gridSizeIssues > 0) {
      recommendations.push(`Wiki pipeline has grid size issues - ensure words_per_puzzle is set to 4`);
    }
    
    if (geminiValidation.issues.gridSizeIssues > 0) {
      recommendations.push(`Gemini pipeline has grid size issues - verify output format conversion`);
    }
    
    if (wikiValidation.qualityMetrics.avgSimilarity < 0.7) {
      recommendations.push(`Wiki pipeline quality is low - consider increasing similarity threshold`);
    }
    
    if (geminiValidation.qualityMetrics.avgSimilarity < 0.7) {
      recommendations.push(`Gemini pipeline quality is low - review embedding model parameters`);
    }
    
    return recommendations;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const batchDir = args[0] || './batch-output';
  
  console.log(`🔍 Batch Quality Validator`);
  console.log(`📁 Validating batches in: ${batchDir}`);
  
  const validator = new BatchQualityValidator();
  
  try {
    // Validate both batches
    const wikiPath = path.join(batchDir, 'set1-wiki-pipeline');
    const geminiPath = path.join(batchDir, 'set2-gemini-pipeline');
    
    console.log(`\n🔍 Validating Wiki pipeline batch...`);
    const wikiValidation = await validator.validateBatch(wikiPath);
    
    console.log(`\n🔍 Validating Gemini pipeline batch...`);
    const geminiValidation = await validator.validateBatch(geminiPath);
    
    // Generate comprehensive report
    const reportPath = path.join(batchDir, 'validation-report.json');
    await validator.generateValidationReport(wikiValidation, geminiValidation, reportPath);
    
    console.log(`\n📊 Validation Summary:`);
    console.log(`   Wiki Pipeline: ${wikiValidation.validPuzzles}/${wikiValidation.totalPuzzles} valid (${(wikiValidation.validationRate * 100).toFixed(1)}%)`);
    console.log(`   Gemini Pipeline: ${geminiValidation.validPuzzles}/${geminiValidation.totalPuzzles} valid (${(geminiValidation.validationRate * 100).toFixed(1)}%)`);
    console.log(`   Overall: ${wikiValidation.validPuzzles + geminiValidation.validPuzzles}/${wikiValidation.totalPuzzles + geminiValidation.totalPuzzles} valid`);
    console.log(`   Report: ${reportPath}`);
    
  } catch (error) {
    console.error(`❌ Validation failed: ${error}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { BatchQualityValidator };