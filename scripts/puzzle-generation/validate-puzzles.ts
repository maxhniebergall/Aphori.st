#!/usr/bin/env node

/**
 * Puzzle Validation Tool
 * Validates generated puzzle files before Firebase import
 */

import fs from 'fs/promises';
import path from 'path';

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  code: string;
  details?: any;
}

export interface PuzzleValidation {
  puzzleId: string;
  date: string;
  valid: boolean;
  issues: ValidationIssue[];
  qualityScore: number;
  recommendations: string[];
}

export interface FileValidation {
  filePath: string;
  valid: boolean;
  puzzleValidations: PuzzleValidation[];
  issues: ValidationIssue[];
  summary: {
    totalPuzzles: number;
    validPuzzles: number;
    avgQuality: number;
  };
}

export interface ValidationReport {
  validatedFiles: number;
  validFiles: number;
  totalPuzzles: number;
  validPuzzles: number;
  globalIssues: ValidationIssue[];
  fileValidations: FileValidation[];
  qualityStats: {
    avgQuality: number;
    minQuality: number;
    maxQuality: number;
    qualityDistribution: Record<string, number>;
  };
  recommendations: string[];
}

export class PuzzleValidator {
  /**
   * Validate all puzzle files in a directory
   */
  async validateDirectory(inputDir: string): Promise<ValidationReport> {
    console.log(`🔍 Validating puzzle files in: ${inputDir}`);
    
    const files = await fs.readdir(inputDir);
    const puzzleFiles = files.filter(f => f.startsWith('puzzles_') && f.endsWith('.json'));
    
    if (puzzleFiles.length === 0) {
      throw new Error(`No puzzle files found in ${inputDir}`);
    }

    console.log(`📁 Found ${puzzleFiles.length} puzzle files to validate`);

    const report: ValidationReport = {
      validatedFiles: puzzleFiles.length,
      validFiles: 0,
      totalPuzzles: 0,
      validPuzzles: 0,
      globalIssues: [],
      fileValidations: [],
      qualityStats: {
        avgQuality: 0,
        minQuality: 1,
        maxQuality: 0,
        qualityDistribution: {
          'excellent': 0, // >= 0.8
          'good': 0,      // >= 0.6
          'fair': 0,      // >= 0.4
          'poor': 0       // < 0.4
        }
      },
      recommendations: []
    };

    let totalQuality = 0;
    let qualityCount = 0;

    for (const file of puzzleFiles) {
      const filePath = path.join(inputDir, file);
      console.log(`\n📄 Validating: ${file}`);
      
      try {
        const fileValidation = await this.validateFile(filePath);
        report.fileValidations.push(fileValidation);
        
        if (fileValidation.valid) {
          report.validFiles++;
        }
        
        report.totalPuzzles += fileValidation.summary.totalPuzzles;
        report.validPuzzles += fileValidation.summary.validPuzzles;
        
        if (fileValidation.summary.avgQuality > 0) {
          totalQuality += fileValidation.summary.avgQuality;
          qualityCount++;
          
          // Update quality stats
          report.qualityStats.minQuality = Math.min(report.qualityStats.minQuality, fileValidation.summary.avgQuality);
          report.qualityStats.maxQuality = Math.max(report.qualityStats.maxQuality, fileValidation.summary.avgQuality);
          
          // Update quality distribution
          const quality = fileValidation.summary.avgQuality;
          if (quality >= 0.8) report.qualityStats.qualityDistribution.excellent++;
          else if (quality >= 0.6) report.qualityStats.qualityDistribution.good++;
          else if (quality >= 0.4) report.qualityStats.qualityDistribution.fair++;
          else report.qualityStats.qualityDistribution.poor++;
        }
        
        console.log(`   ✅ ${fileValidation.summary.validPuzzles}/${fileValidation.summary.totalPuzzles} puzzles valid`);
        console.log(`   ⭐ Quality: ${fileValidation.summary.avgQuality.toFixed(3)}`);
        
      } catch (error) {
        console.log(`   ❌ Failed to validate: ${(error as Error).message}`);
        report.globalIssues.push({
          severity: 'error',
          code: 'FILE_READ_ERROR',
          message: `Failed to read or parse ${file}: ${(error as Error).message}`
        });
      }
    }

    // Calculate final stats
    report.qualityStats.avgQuality = qualityCount > 0 ? totalQuality / qualityCount : 0;
    
    // Generate recommendations
    report.recommendations = this.generateGlobalRecommendations(report);
    
    return report;
  }

  /**
   * Validate a single puzzle file
   */
  async validateFile(filePath: string): Promise<FileValidation> {
    const fileName = path.basename(filePath);
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    
    const validation: FileValidation = {
      filePath,
      valid: true,
      puzzleValidations: [],
      issues: [],
      summary: {
        totalPuzzles: 0,
        validPuzzles: 0,
        avgQuality: 0
      }
    };

    // Validate file structure
    const structureIssues = this.validateFileStructure(data, fileName);
    validation.issues.push(...structureIssues);

    // Find puzzle data
    const puzzlePaths = Object.keys(data).filter(key => key.startsWith('dailyPuzzles/themes/'));
    
    if (puzzlePaths.length === 0) {
      validation.issues.push({
        severity: 'error',
        code: 'NO_PUZZLE_DATA',
        message: 'No puzzle data found in file'
      });
      validation.valid = false;
      return validation;
    }

    // Validate each date's puzzles
    let totalQuality = 0;
    let qualityCount = 0;

    for (const puzzlePath of puzzlePaths) {
      const dateMatch = puzzlePath.match(/dailyPuzzles\/themes\/(.+)$/);
      const date = dateMatch ? dateMatch[1] : 'unknown';
      
      const puzzles = Object.values(data[puzzlePath]) as any[];
      validation.summary.totalPuzzles += puzzles.length;
      
      for (const puzzle of puzzles) {
        const puzzleValidation = await this.validatePuzzle(puzzle, date);
        validation.puzzleValidations.push(puzzleValidation);
        
        if (puzzleValidation.valid) {
          validation.summary.validPuzzles++;
        }
        
        if (puzzleValidation.qualityScore > 0) {
          totalQuality += puzzleValidation.qualityScore;
          qualityCount++;
        }
      }
    }

    validation.summary.avgQuality = qualityCount > 0 ? totalQuality / qualityCount : 0;
    
    // File is valid if it has no critical issues and at least some valid puzzles
    validation.valid = validation.issues.every(issue => issue.severity !== 'error') && 
                     validation.summary.validPuzzles > 0;

    return validation;
  }

  /**
   * Validate file structure
   */
  private validateFileStructure(data: any, fileName: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for required top-level structure
    const hasMinimalStructure = Object.keys(data).some(key => 
      key.startsWith('dailyPuzzles/themes/') || key.startsWith('puzzleIndex/themes/')
    );

    if (!hasMinimalStructure) {
      issues.push({
        severity: 'error',
        code: 'INVALID_STRUCTURE',
        message: 'File does not contain expected puzzle structure'
      });
    }

    // Check for corresponding index entries
    const puzzlePaths = Object.keys(data).filter(key => key.startsWith('dailyPuzzles/themes/'));
    const indexPaths = Object.keys(data).filter(key => key.startsWith('puzzleIndex/themes/'));
    
    for (const puzzlePath of puzzlePaths) {
      const date = puzzlePath.replace('dailyPuzzles/themes/', '');
      const expectedIndexPath = `puzzleIndex/themes/${date}`;
      
      if (!indexPaths.includes(expectedIndexPath)) {
        issues.push({
          severity: 'warning',
          code: 'MISSING_INDEX',
          message: `Missing puzzle index for date ${date}`,
          details: { expectedPath: expectedIndexPath }
        });
      }
    }

    return issues;
  }

  /**
   * Validate a single puzzle
   */
  private async validatePuzzle(puzzle: any, date: string): Promise<PuzzleValidation> {
    const validation: PuzzleValidation = {
      puzzleId: puzzle.id || 'unknown',
      date,
      valid: true,
      issues: [],
      qualityScore: 0,
      recommendations: []
    };

    // Required fields validation
    const requiredFields = ['id', 'date', 'gridSize', 'words', 'categories'];
    for (const field of requiredFields) {
      if (!puzzle[field]) {
        validation.issues.push({
          severity: 'error',
          code: 'MISSING_FIELD',
          message: `Missing required field: ${field}`
        });
      }
    }

    // Grid size validation
    if (puzzle.gridSize && !Number.isInteger(puzzle.gridSize)) {
      validation.issues.push({
        severity: 'error',
        code: 'INVALID_GRID_SIZE',
        message: `Grid size must be an integer, got: ${puzzle.gridSize}`
      });
    }

    // Words validation
    if (puzzle.words && puzzle.gridSize) {
      const expectedWordCount = puzzle.gridSize * puzzle.gridSize;
      if (puzzle.words.length !== expectedWordCount) {
        validation.issues.push({
          severity: 'error',
          code: 'WORD_COUNT_MISMATCH',
          message: `Expected ${expectedWordCount} words for ${puzzle.gridSize}x${puzzle.gridSize} grid, got ${puzzle.words.length}`
        });
      }

      // Check for duplicate words
      const uniqueWords = new Set(puzzle.words);
      if (uniqueWords.size !== puzzle.words.length) {
        validation.issues.push({
          severity: 'error',
          code: 'DUPLICATE_WORDS',
          message: 'Puzzle contains duplicate words'
        });
      }

      // Validate individual words
      for (const word of puzzle.words) {
        if (!this.isValidWord(word)) {
          validation.issues.push({
            severity: 'warning',
            code: 'INVALID_WORD',
            message: `Word may not be suitable for themes game: "${word}"`
          });
        }
      }
    }

    // Categories validation
    if (puzzle.categories && puzzle.gridSize) {
      if (puzzle.categories.length !== puzzle.gridSize) {
        validation.issues.push({
          severity: 'error',
          code: 'CATEGORY_COUNT_MISMATCH',
          message: `Expected ${puzzle.gridSize} categories, got ${puzzle.categories.length}`
        });
      }

      for (let i = 0; i < puzzle.categories.length; i++) {
        const category = puzzle.categories[i];
        const categoryIssues = this.validateCategory(category, i + 1, puzzle.gridSize);
        validation.issues.push(...categoryIssues);
      }
    }

    // Difficulty validation
    if (puzzle.difficulty !== undefined) {
      if (typeof puzzle.difficulty !== 'number' || puzzle.difficulty < 1 || puzzle.difficulty > 10) {
        validation.issues.push({
          severity: 'warning',
          code: 'INVALID_DIFFICULTY',
          message: `Difficulty should be between 1-10, got: ${puzzle.difficulty}`
        });
      }
    }

    // Quality score calculation
    validation.qualityScore = this.calculatePuzzleQuality(puzzle);
    
    // Generate recommendations
    validation.recommendations = this.generatePuzzleRecommendations(puzzle, validation.issues);
    
    // Puzzle is valid if no critical errors
    validation.valid = validation.issues.every(issue => issue.severity !== 'error');

    return validation;
  }

  /**
   * Validate a category
   */
  private validateCategory(category: any, categoryNumber: number, expectedWordCount: number): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const prefix = `Category ${categoryNumber}`;

    // Required fields
    if (!category.themeWord) {
      issues.push({
        severity: 'error',
        code: 'MISSING_THEME_WORD',
        message: `${prefix}: Missing theme word`
      });
    }

    if (!category.words || !Array.isArray(category.words)) {
      issues.push({
        severity: 'error',
        code: 'MISSING_CATEGORY_WORDS',
        message: `${prefix}: Missing or invalid words array`
      });
    } else if (category.words.length !== expectedWordCount) {
      issues.push({
        severity: 'error',
        code: 'CATEGORY_WORD_COUNT',
        message: `${prefix}: Expected ${expectedWordCount} words, got ${category.words.length}`
      });
    }

    // Similarity validation
    if (category.similarity !== undefined) {
      if (typeof category.similarity !== 'number' || category.similarity < 0 || category.similarity > 1) {
        issues.push({
          severity: 'warning',
          code: 'INVALID_SIMILARITY',
          message: `${prefix}: Similarity should be between 0-1, got: ${category.similarity}`
        });
      } else if (category.similarity < 0.3) {
        issues.push({
          severity: 'warning',
          code: 'LOW_SIMILARITY',
          message: `${prefix}: Low similarity score (${category.similarity.toFixed(3)})`
        });
      }
    }

    return issues;
  }

  /**
   * Check if a word is valid for themes game
   */
  private isValidWord(word: any): boolean {
    if (!word || typeof word !== 'string') return false;
    
    const cleaned = word.toLowerCase().trim();
    
    // Length check
    if (cleaned.length < 3 || cleaned.length > 12) return false;
    
    // Character check
    if (!/^[a-z]+$/.test(cleaned)) return false;
    
    return true;
  }

  /**
   * Calculate puzzle quality score
   */
  private calculatePuzzleQuality(puzzle: any): number {
    let score = 0;
    let factors = 0;

    // Word quality (30%)
    if (puzzle.words && Array.isArray(puzzle.words)) {
      const validWords = puzzle.words.filter((word: any) => this.isValidWord(word));
      const wordQuality = validWords.length / puzzle.words.length;
      score += wordQuality * 0.3;
      factors += 0.3;
    }

    // Category quality (40%)
    if (puzzle.categories && Array.isArray(puzzle.categories)) {
      let categoryScore = 0;
      for (const category of puzzle.categories) {
        if (category.similarity && category.similarity >= 0.3) {
          categoryScore += category.similarity;
        }
      }
      if (puzzle.categories.length > 0) {
        const avgCategoryQuality = categoryScore / puzzle.categories.length;
        score += avgCategoryQuality * 0.4;
        factors += 0.4;
      }
    }

    // Structural integrity (30%)
    let structureScore = 1.0;
    if (puzzle.words && puzzle.gridSize) {
      const expectedWords = puzzle.gridSize * puzzle.gridSize;
      if (puzzle.words.length !== expectedWords) structureScore -= 0.5;
      
      const uniqueWords = new Set(puzzle.words);
      if (uniqueWords.size !== puzzle.words.length) structureScore -= 0.3;
    }
    score += Math.max(0, structureScore) * 0.3;
    factors += 0.3;

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Generate puzzle-specific recommendations
   */
  private generatePuzzleRecommendations(puzzle: any, issues: ValidationIssue[]): string[] {
    const recommendations: string[] = [];

    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    if (errorCount > 0) {
      recommendations.push(`Fix ${errorCount} critical error(s) before importing`);
    }

    if (warningCount > 0) {
      recommendations.push(`Review ${warningCount} warning(s) for quality improvement`);
    }

    // Quality-based recommendations
    const quality = this.calculatePuzzleQuality(puzzle);
    if (quality < 0.4) {
      recommendations.push('Consider regenerating this puzzle due to low quality');
    } else if (quality < 0.6) {
      recommendations.push('Consider manual review before importing');
    }

    return recommendations;
  }

  /**
   * Generate global recommendations
   */
  private generateGlobalRecommendations(report: ValidationReport): string[] {
    const recommendations: string[] = [];

    const successRate = report.validFiles / report.validatedFiles;
    const puzzleSuccessRate = report.validPuzzles / Math.max(1, report.totalPuzzles);

    if (successRate < 0.8) {
      recommendations.push('High failure rate - review generation parameters');
    }

    if (report.qualityStats.avgQuality < 0.5) {
      recommendations.push('Low average quality - consider increasing quality threshold');
    }

    if (report.qualityStats.qualityDistribution.poor > report.totalPuzzles * 0.2) {
      recommendations.push('High number of poor quality puzzles - review generation algorithm');
    }

    if (report.globalIssues.length > 0) {
      recommendations.push('Address file-level issues before proceeding with import');
    }

    if (puzzleSuccessRate > 0.9 && report.qualityStats.avgQuality > 0.7) {
      recommendations.push('Excellent quality! Ready for production import');
    }

    return recommendations;
  }

  /**
   * Print validation report summary
   */
  printSummary(report: ValidationReport): void {
    console.log('\n📊 Validation Summary:');
    console.log(`   📁 Files: ${report.validFiles}/${report.validatedFiles} valid`);
    console.log(`   🎲 Puzzles: ${report.validPuzzles}/${report.totalPuzzles} valid`);
    console.log(`   ⭐ Quality: ${report.qualityStats.avgQuality.toFixed(3)} average`);
    console.log(`   📈 Range: ${report.qualityStats.minQuality.toFixed(3)} - ${report.qualityStats.maxQuality.toFixed(3)}`);
    
    console.log('\n📊 Quality Distribution:');
    console.log(`   🌟 Excellent (≥0.8): ${report.qualityStats.qualityDistribution.excellent}`);
    console.log(`   ✅ Good (≥0.6): ${report.qualityStats.qualityDistribution.good}`);
    console.log(`   ⚠️  Fair (≥0.4): ${report.qualityStats.qualityDistribution.fair}`);
    console.log(`   ❌ Poor (<0.4): ${report.qualityStats.qualityDistribution.poor}`);

    if (report.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      report.recommendations.forEach((rec, idx) => {
        console.log(`   ${idx + 1}. ${rec}`);
      });
    }

    if (report.globalIssues.length > 0) {
      console.log('\n⚠️  Global Issues:');
      report.globalIssues.forEach((issue, idx) => {
        console.log(`   ${idx + 1}. [${issue.severity.toUpperCase()}] ${issue.message}`);
      });
    }
  }
}

/**
 * CLI Interface
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
📋 Puzzle Validation Tool

Usage:
  npm run validate <inputDir> [options]

Arguments:
  inputDir    Directory containing puzzle JSON files

Options:
  --verbose   Show detailed validation results
  --report    Save detailed report to file
  --help      Show this help message

Examples:
  npm run validate ./generated-puzzles
  npm run validate ./output --verbose --report
`);
    process.exit(0);
  }

  const inputDir = args[0];
  if (!inputDir) {
    console.error('❌ Error: Input directory required');
    console.log('Use --help for usage information');
    process.exit(1);
  }

  const verbose = args.includes('--verbose');
  const saveReport = args.includes('--report');

  try {
    const validator = new PuzzleValidator();
    const report = await validator.validateDirectory(inputDir);
    
    validator.printSummary(report);
    
    if (verbose) {
      console.log('\n📋 Detailed Results:');
      report.fileValidations.forEach((fileVal, idx) => {
        console.log(`\n${idx + 1}. ${path.basename(fileVal.filePath)}`);
        console.log(`   Valid: ${fileVal.valid ? '✅' : '❌'}`);
        console.log(`   Puzzles: ${fileVal.summary.validPuzzles}/${fileVal.summary.totalPuzzles}`);
        console.log(`   Quality: ${fileVal.summary.avgQuality.toFixed(3)}`);
        
        if (fileVal.issues.length > 0) {
          console.log(`   Issues: ${fileVal.issues.length}`);
          fileVal.issues.forEach(issue => {
            console.log(`     [${issue.severity}] ${issue.message}`);
          });
        }
      });
    }

    if (saveReport) {
      const reportPath = path.join(inputDir, 'validation_report.json');
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`\n📄 Detailed report saved: ${reportPath}`);
    }

    // Exit with error code if validation failed
    if (report.validFiles < report.validatedFiles || report.validPuzzles < report.totalPuzzles) {
      process.exit(1);
    }

  } catch (error) {
    console.error('💥 Validation failed:', (error as Error).message);
    process.exit(1);
  }
}

// Run CLI if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}