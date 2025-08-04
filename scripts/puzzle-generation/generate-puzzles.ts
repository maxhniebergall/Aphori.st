#!/usr/bin/env node

/**
 * Main Puzzle Generation Script
 * Generates themed puzzles and outputs JSON files for Firebase import
 */

import fs from 'fs/promises';
import path from 'path';
import { FullVectorLoader } from './FullVectorLoader.js';
import { HighQualityPuzzleGenerator, GeneratedPuzzleOutput, GeneratedPuzzle } from './HighQualityPuzzleGenerator.js';

export interface GenerationConfig {
  startDate: string;
  endDate: string;
  puzzlesPerDay: number;
  outputDir: string;
  qualityThreshold: number;
  maxAttemptsPerDay: number;
  verbose: boolean;
}

export interface GenerationSummary {
  totalDates: number;
  successfulDates: number;
  totalPuzzles: number;
  avgQuality: number;
  failedDates: string[];
  processingTime: number;
}

class PuzzleGenerationScript {
  constructor(
    private vectorLoader: FullVectorLoader,
    private puzzleGenerator: HighQualityPuzzleGenerator
  ) {}

  /**
   * Generate puzzles for a date range
   */
  async generateDateRange(config: GenerationConfig): Promise<GenerationSummary> {
    const startTime = Date.now();
    
    console.log(`🎯 Generating puzzles from ${config.startDate} to ${config.endDate}`);
    console.log(`📊 ${config.puzzlesPerDay} puzzles per day, quality threshold: ${config.qualityThreshold}`);
    
    // Ensure output directory exists
    await this.ensureOutputDir(config.outputDir);
    
    const dates = this.createDateRange(config.startDate, config.endDate);
    const results: GenerationSummary = {
      totalDates: dates.length,
      successfulDates: 0,
      totalPuzzles: 0,
      avgQuality: 0,
      failedDates: [],
      processingTime: 0
    };

    let totalQuality = 0;
    let qualityCount = 0;
    
    // Collect all puzzles in a single Firebase structure
    const firebaseData: Record<string, any> = {};

    for (const date of dates) {
      console.log(`\n📅 Processing date: ${date}`);
      
      try {
        const output = await this.puzzleGenerator.generateDailyPuzzles(date, config.puzzlesPerDay);
        
        if (output.puzzles.length > 0) {
          // Check quality threshold
          if (output.metadata.qualityScore >= config.qualityThreshold) {
            // Add to combined Firebase data structure
            this.addToFirebaseData(firebaseData, date, output);
            
            results.successfulDates++;
            results.totalPuzzles += output.puzzles.length;
            totalQuality += output.metadata.qualityScore;
            qualityCount++;
            
            console.log(`✅ ${date}: Generated ${output.puzzles.length}/${config.puzzlesPerDay} puzzles (quality: ${output.metadata.qualityScore.toFixed(3)})`);
            
            if (config.verbose) {
              this.logPuzzleDetails(output);
            }
          } else {
            results.failedDates.push(date);
            console.log(`❌ ${date}: Quality too low (${output.metadata.qualityScore.toFixed(3)} < ${config.qualityThreshold})`);
          }
        } else {
          results.failedDates.push(date);
          console.log(`❌ ${date}: Failed to generate puzzles`);
        }
      } catch (error) {
        results.failedDates.push(date);
        console.log(`💥 ${date}: Error - ${(error as Error).message}`);
        if (config.verbose) {
          console.error(error);
        }
      }
    }

    results.avgQuality = qualityCount > 0 ? totalQuality / qualityCount : 0;
    results.processingTime = Date.now() - startTime;

    // Save single combined Firebase file
    if (Object.keys(firebaseData).length > 0) {
      await this.saveCombinedFirebaseFile(firebaseData, config);
    }

    // Generate summary report
    await this.generateSummaryReport(results, config);
    
    return results;
  }

  /**
   * Add puzzles to the combined Firebase data structure (organized by size)
   */
  private addToFirebaseData(firebaseData: Record<string, any>, date: string, output: GeneratedPuzzleOutput): void {
    // Group puzzles by size
    const puzzlesBySize = output.puzzles.reduce((acc, puzzle) => {
      const size = puzzle.gridSize;
      if (!acc[size]) {
        acc[size] = [];
      }
      acc[size].push(puzzle);
      return acc;
    }, {} as Record<number, GeneratedPuzzle[]>);

    // Add daily puzzles organized by size
    Object.entries(puzzlesBySize).forEach(([size, puzzles]) => {
      firebaseData[`dailyPuzzles/themes/${date}/${size}x${size}`] = puzzles.reduce((acc, puzzle) => {
        acc[puzzle.id] = {
          id: puzzle.id,
          date: puzzle.date,
          puzzleNumber: puzzle.puzzleNumber,
          gridSize: puzzle.gridSize,
          difficulty: puzzle.difficulty,
          words: puzzle.words,
          categories: puzzle.categories.map((cat: any) => ({
            id: cat.id,
            themeWord: cat.themeWord,
            words: cat.words,
            difficulty: cat.difficulty,
            similarity: cat.similarity
          })),
          createdAt: puzzle.metadata.generatedAt,
          metadata: {
            avgSimilarity: puzzle.metadata.avgSimilarity,
            qualityScore: puzzle.metadata.qualityScore,
            generatedBy: 'offline_generator_v1.0',
            version: '1.0.0'
          }
        };
        return acc;
      }, {} as Record<string, any>);
    });
    
    // Add puzzle index with size breakdown
    const sizeCounts = Object.entries(puzzlesBySize).reduce((acc, [size, puzzles]) => {
      acc[`${size}x${size}`] = puzzles.length;
      return acc;
    }, {} as Record<string, number>);

    firebaseData[`puzzleIndex/themes/${date}`] = {
      totalCount: output.puzzles.length,
      sizeCounts: sizeCounts,
      availableSizes: Object.keys(puzzlesBySize).map(size => `${size}x${size}`),
      lastUpdated: output.metadata.generatedAt,
      status: 'generated',
      puzzleIds: output.puzzles.map(p => p.id),
      generatorVersion: output.metadata.generatorVersion,
      qualityScore: output.metadata.qualityScore,
      metadata: {
        totalAttempts: output.metadata.totalAttempts,
        successRate: output.metadata.successRate,
        difficultyProgression: output.metadata.difficultyProgression
      }
    };
  }

  /**
   * Save combined Firebase data to single JSON file
   */
  private async saveCombinedFirebaseFile(firebaseData: Record<string, any>, config: GenerationConfig): Promise<void> {
    const filename = path.join(config.outputDir, 'firebase_import.json');
    await fs.writeFile(filename, JSON.stringify(firebaseData, null, 2));
    
    console.log(`\n💾 Combined Firebase file saved: ${filename}`);
    console.log(`📊 Contains data for ${Object.keys(firebaseData).filter(k => k.startsWith('dailyPuzzles')).length} dates`);
    console.log(`🔥 Ready for Firebase RTDB import!`);
  }

  /**
   * Generate summary report
   */
  private async generateSummaryReport(results: GenerationSummary, config: GenerationConfig): Promise<void> {
    const report = {
      generatedAt: new Date().toISOString(),
      config: {
        dateRange: `${config.startDate} to ${config.endDate}`,
        puzzlesPerDay: config.puzzlesPerDay,
        qualityThreshold: config.qualityThreshold,
        outputDirectory: config.outputDir
      },
      summary: {
        totalDates: results.totalDates,
        successfulDates: results.successfulDates,
        failedDates: results.failedDates.length,
        totalPuzzles: results.totalPuzzles,
        averageQuality: results.avgQuality,
        successRate: `${((results.successfulDates / results.totalDates) * 100).toFixed(1)}%`,
        processingTime: `${(results.processingTime / 1000).toFixed(1)}s`
      },
      failedDates: results.failedDates,
      importInstructions: {
        firebase: "Import each JSON file using Firebase Console > Realtime Database > Import JSON",
        structure: "Each file contains both puzzle data and index for a single date",
        validation: "Review puzzle quality and test gameplay before importing to production database",
        paths: {
          puzzleData: "dailyPuzzles/themes/{date}",
          puzzleIndex: "puzzleIndex/themes/{date}"
        }
      },
      qualityMetrics: {
        threshold: config.qualityThreshold,
        averageScore: results.avgQuality,
        recommendation: results.avgQuality >= 0.7 ? "Excellent quality" : 
                       results.avgQuality >= 0.6 ? "Good quality" : 
                       results.avgQuality >= 0.5 ? "Acceptable quality" : "Quality needs improvement"
      }
    };

    const reportPath = path.join(config.outputDir, 'generation_report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`\n📋 Summary Report:`);
    console.log(`   📊 Success: ${results.successfulDates}/${results.totalDates} dates (${((results.successfulDates / results.totalDates) * 100).toFixed(1)}%)`);
    console.log(`   🎮 Puzzles: ${results.totalPuzzles} total`);
    console.log(`   ⭐ Quality: ${results.avgQuality.toFixed(3)} average`);
    console.log(`   ⏱️  Time: ${(results.processingTime / 1000).toFixed(1)}s`);
    console.log(`   📄 Report: ${reportPath}`);
    
    if (results.failedDates.length > 0) {
      console.log(`   ❌ Failed: ${results.failedDates.join(', ')}`);
    }
  }

  /**
   * Log detailed puzzle information
   */
  private logPuzzleDetails(output: GeneratedPuzzleOutput): void {
    output.puzzles.forEach((puzzle, idx) => {
      console.log(`\n   🎲 Puzzle ${idx + 1} Details:`);
      console.log(`      ID: ${puzzle.id}`);
      console.log(`      Difficulty: ${puzzle.difficulty}/10`);
      console.log(`      Quality: ${puzzle.metadata.qualityScore.toFixed(3)}`);
      console.log(`      Categories:`);
      
      puzzle.categories.forEach((cat, catIdx) => {
        const metrics = cat.difficultyMetrics;
        console.log(`        ${catIdx + 1}. ${cat.themeWord} (D=${cat.difficulty}, N=${metrics.totalNeighbors}, range=${metrics.selectedRange})`);
        console.log(`           Words: [${cat.words.join(', ')}]`);
        console.log(`           Similarity: ${cat.similarity.toFixed(3)}`);
      });
    });
  }

  /**
   * Generate array of date strings
   */
  private createDateRange(startDate: string, endDate: string): string[] {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dates: string[] = [];
    
    const current = new Date(start);
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    
    return dates;
  }

  /**
   * Ensure output directory exists
   */
  private async ensureOutputDir(outputDir: string): Promise<void> {
    try {
      await fs.access(outputDir);
    } catch {
      await fs.mkdir(outputDir, { recursive: true });
      console.log(`📁 Created output directory: ${outputDir}`);
    }
  }
}

/**
 * CLI Interface
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const config: GenerationConfig = {
    startDate: args[0] || '2025-08-05',
    endDate: args[1] || '2025-08-11',
    puzzlesPerDay: parseInt(args[2]) || 7, // Default 7 puzzles (sizes 4x4 through 10x10)
    qualityThreshold: parseFloat(args[3]) || 0.5,
    outputDir: args[4] || './generated-puzzles',
    maxAttemptsPerDay: parseInt(args[5]) || 5,
    verbose: args.includes('--verbose') || args.includes('-v')
  };

  console.log('🚀 Initializing Puzzle Generation System...');
  console.log('📊 Configuration:');
  console.log(`   📅 Date Range: ${config.startDate} to ${config.endDate}`);
  console.log(`   🎲 Puzzles/Day: ${config.puzzlesPerDay}`);
  console.log(`   ⭐ Quality Threshold: ${config.qualityThreshold}`);
  console.log(`   📁 Output: ${config.outputDir}`);
  console.log(`   🔍 Verbose: ${config.verbose ? 'Yes' : 'No'}`);

  try {
    // Initialize vector loader
    console.log('\n🔄 Loading full vector index...');
    const vectorLoader = new FullVectorLoader();
    const loadResult = await vectorLoader.initialize();
    
    if (!loadResult.success) {
      throw new Error('Failed to load vector index');
    }
    
    console.log(`✅ Vector index loaded: ${loadResult.loadedWords}/${loadResult.totalWords} words`);
    console.log(`📊 Stats: ${vectorLoader.getStats().memoryUsage} memory usage`);

    // Initialize puzzle generator
    console.log('\n🎯 Starting puzzle generation...');
    const puzzleGenerator = new HighQualityPuzzleGenerator(vectorLoader);
    const script = new PuzzleGenerationScript(vectorLoader, puzzleGenerator);

    // Generate puzzles
    const results = await script.generateDateRange(config);
    
    console.log('\n✨ Generation Complete!');
    
    if (results.successfulDates === results.totalDates) {
      console.log('🎉 All dates generated successfully!');
    } else if (results.successfulDates > 0) {
      console.log(`⚠️ Partial success: ${results.successfulDates}/${results.totalDates} dates`);
    } else {
      console.log('❌ Generation failed for all dates');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('💥 Fatal error:', (error as Error).message);
    if (config.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
📚 Themes Puzzle Generator - Offline Generation Tool

Usage:
  npm run generate [startDate] [endDate] [puzzlesPerDay] [qualityThreshold] [outputDir] [maxAttempts] [options]

Arguments:
  startDate        Start date (YYYY-MM-DD) [default: 2025-08-05]
  endDate          End date (YYYY-MM-DD) [default: 2025-08-11]
  puzzlesPerDay    Number of puzzles per day [default: 7] - Generates sizes 4x4 through 10x10
  qualityThreshold Minimum quality score (0-1) [default: 0.5]
  outputDir        Output directory [default: ./generated-puzzles]
  maxAttempts      Max attempts per day [default: 5]

Options:
  --verbose, -v    Verbose output with puzzle details
  --help, -h       Show this help message

Examples:
  # Generate all puzzle sizes (4x4 through 10x10) for next week
  npm run generate 2025-08-05 2025-08-11

  # Generate puzzles for entire August with high quality
  npm run generate 2025-08-01 2025-08-31 7 0.6

  # Generate with verbose output
  npm run generate 2025-08-05 2025-08-07 7 0.5 ./test-output 10 --verbose

Progressive Difficulty Algorithm:
  Uses N = K + D algorithm where:
  - K = puzzle size (4 for 4x4 grid)
  - D = category difficulty (1, 2, 3, 4)
  - N = total neighbors to find
  
  Category 1: N=5, use neighbors 2-5 (discard closest)
  Category 2: N=6, use neighbors 3-6 (discard 2 closest)  
  Category 3: N=7, use neighbors 4-7 (discard 3 closest)
  Category 4: N=8, use neighbors 5-8 (discard 4 closest)
`);
}

// Run CLI if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };