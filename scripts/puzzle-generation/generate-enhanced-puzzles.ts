#!/usr/bin/env node

/**
 * Enhanced Puzzle Generation Script
 * Integrates the Gemini-based algorithm from the data science pipeline
 */

import fs from 'fs/promises';
import path from 'path';
import { FullVectorLoader } from './FullVectorLoader.js';
import { GeminiEnhancedPuzzleGenerator, GeminiConfig, WikiThemeConfig } from './GeminiEnhancedPuzzleGenerator.js';
import { GeneratedPuzzleOutput, GeneratedPuzzle } from './HighQualityPuzzleGenerator.js';

export interface EnhancedGenerationConfig {
  startDate: string;
  endDate: string;
  puzzlesPerDay: number;
  outputDir: string;
  qualityThreshold: number;
  maxAttemptsPerDay: number;
  verbose: boolean;
  useGemini: boolean;
  geminiApiKey?: string;
  wikiCategoriesPath?: string;
}

export interface EnhancedGenerationSummary {
  totalDates: number;
  successfulDates: number;
  totalPuzzles: number;
  avgQuality: number;
  failedDates: string[];
  processingTime: number;
  enhancementStats: {
    geminiEnhanced: number;
    localFallback: number;
    enhancementSuccessRate: number;
  };
}

class EnhancedPuzzleGenerationScript {
  constructor(
    private vectorLoader: FullVectorLoader,
    private puzzleGenerator: GeminiEnhancedPuzzleGenerator
  ) {}

  /**
   * Generate puzzles for a date range with enhanced algorithm
   */
  async generateDateRange(config: EnhancedGenerationConfig): Promise<EnhancedGenerationSummary> {
    const startTime = Date.now();
    
    console.log(`🎯 Generating enhanced puzzles from ${config.startDate} to ${config.endDate}`);
    console.log(`📊 ${config.puzzlesPerDay} puzzles per day, quality threshold: ${config.qualityThreshold}`);
    console.log(`🤖 Gemini enhancement: ${config.useGemini ? 'ENABLED' : 'DISABLED'}`);
    
    // Ensure output directory exists
    await this.ensureOutputDir(config.outputDir);
    
    const dates = this.createDateRange(config.startDate, config.endDate);
    const results: EnhancedGenerationSummary = {
      totalDates: dates.length,
      successfulDates: 0,
      totalPuzzles: 0,
      avgQuality: 0,
      failedDates: [],
      processingTime: 0,
      enhancementStats: {
        geminiEnhanced: 0,
        localFallback: 0,
        enhancementSuccessRate: 0
      }
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
            
            // Track enhancement statistics
            this.updateEnhancementStats(results.enhancementStats, output.puzzles);
            
            results.successfulDates++;
            results.totalPuzzles += output.puzzles.length;
            totalQuality += output.metadata.qualityScore;
            qualityCount++;
            
            console.log(`✅ ${date}: Generated ${output.puzzles.length}/${config.puzzlesPerDay} puzzles (quality: ${output.metadata.qualityScore.toFixed(3)})`);
            
            if (config.verbose) {
              this.logEnhancedPuzzleDetails(output);
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

    // Calculate enhancement success rate
    const totalEnhancements = results.enhancementStats.geminiEnhanced + results.enhancementStats.localFallback;
    results.enhancementStats.enhancementSuccessRate = totalEnhancements > 0 
      ? results.enhancementStats.geminiEnhanced / totalEnhancements 
      : 0;

    // Save single combined Firebase file
    if (Object.keys(firebaseData).length > 0) {
      await this.saveCombinedFirebaseFile(firebaseData, config);
    }

    // Generate enhanced summary report
    await this.generateEnhancedSummaryReport(results, config);
    
    return results;
  }

  /**
   * Update enhancement statistics from generated puzzles
   */
  private updateEnhancementStats(stats: any, puzzles: GeneratedPuzzle[]): void {
    for (const puzzle of puzzles) {
      for (const category of puzzle.categories) {
        const enhancedCategory = category as any;
        const method = enhancedCategory.enhancementMethod || 'local';
        
        if (method === 'gemini') {
          stats.geminiEnhanced++;
        } else {
          stats.localFallback++;
        }
      }
    }
  }

  /**
   * Add puzzles to Firebase data structure with enhanced metadata
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

    // Ensure nested structure exists
    if (!firebaseData.dailyPuzzles) {
      firebaseData.dailyPuzzles = {};
    }
    if (!firebaseData.dailyPuzzles.enhanced) {
      firebaseData.dailyPuzzles.enhanced = {};
    }
    if (!firebaseData.dailyPuzzles.enhanced[date]) {
      firebaseData.dailyPuzzles.enhanced[date] = {};
    }

    if (!firebaseData.puzzleIndex) {
      firebaseData.puzzleIndex = {};
    }
    if (!firebaseData.puzzleIndex.enhanced) {
      firebaseData.puzzleIndex.enhanced = {};
    }

    // Add daily puzzles organized by size with enhanced metadata
    Object.entries(puzzlesBySize).forEach(([size, puzzles]) => {
      const sizeKey = `${size}x${size}`;
      firebaseData.dailyPuzzles.enhanced[date][sizeKey] = puzzles.reduce((acc, puzzle) => {
        const enhancedCategories = puzzle.categories.map((cat: any) => ({
          id: cat.id,
          themeWord: cat.themeWord,
          words: cat.words,
          difficulty: cat.difficulty,
          similarity: cat.similarity,
          enhancementMethod: cat.enhancementMethod || 'local',
          geminiSimilarities: cat.geminiSimilarities,
          allCandidates: cat.allCandidates
        }));

        acc[puzzle.id] = {
          id: puzzle.id,
          date: puzzle.date,
          puzzleNumber: puzzle.puzzleNumber,
          gridSize: puzzle.gridSize,
          difficulty: puzzle.difficulty,
          words: puzzle.words,
          categories: enhancedCategories,
          createdAt: puzzle.metadata.generatedAt,
          metadata: {
            avgSimilarity: puzzle.metadata.avgSimilarity,
            qualityScore: puzzle.metadata.qualityScore,
            generatedBy: 'enhanced_generator_v2.0',
            version: '2.0.0-gemini',
            enhancementEnabled: output.metadata.difficultyProgression.algorithmUsed.includes('Gemini')
          }
        };
        return acc;
      }, {} as Record<string, any>);
    });
    
    // Add enhanced puzzle index
    const sizeCounts = Object.entries(puzzlesBySize).reduce((acc, [size, puzzles]) => {
      acc[`${size}x${size}`] = puzzles.length;
      return acc;
    }, {} as Record<string, number>);

    firebaseData.puzzleIndex.enhanced[date] = {
      totalCount: output.puzzles.length,
      sizeCounts: sizeCounts,
      availableSizes: Object.keys(puzzlesBySize).map(size => `${size}x${size}`),
      lastUpdated: output.metadata.generatedAt,
      status: 'generated',
      puzzleIds: output.puzzles.map(p => p.id),
      generatorVersion: output.metadata.generatorVersion,
      qualityScore: output.metadata.qualityScore,
      algorithmUsed: output.metadata.difficultyProgression.algorithmUsed,
      metadata: {
        totalAttempts: output.metadata.totalAttempts,
        successRate: output.metadata.successRate,
        difficultyProgression: output.metadata.difficultyProgression
      }
    };
  }

  /**
   * Log detailed enhanced puzzle information
   */
  private logEnhancedPuzzleDetails(output: GeneratedPuzzleOutput): void {
    output.puzzles.forEach((puzzle, idx) => {
      console.log(`\n   🎲 Enhanced Puzzle ${idx + 1} Details:`);
      console.log(`      ID: ${puzzle.id}`);
      console.log(`      Difficulty: ${puzzle.difficulty}/10`);
      console.log(`      Quality: ${puzzle.metadata.qualityScore.toFixed(3)}`);
      console.log(`      Categories:`);
      
      puzzle.categories.forEach((cat, catIdx) => {
        const enhancedCat = cat as any;
        const method = enhancedCat.enhancementMethod || 'local';
        const metrics = cat.difficultyMetrics;
        
        console.log(`        ${catIdx + 1}. ${cat.themeWord} (D=${cat.difficulty}, ${method.toUpperCase()})`);
        console.log(`           Words: [${cat.words.join(', ')}]`);
        console.log(`           Similarity: ${cat.similarity.toFixed(3)}`);
        
        if (enhancedCat.geminiSimilarities) {
          const geminiAvg = enhancedCat.geminiSimilarities.reduce((a: number, b: number) => a + b, 0) / enhancedCat.geminiSimilarities.length;
          console.log(`           Gemini Avg: ${geminiAvg.toFixed(3)}`);
        }
      });
    });
  }

  /**
   * Generate enhanced summary report
   */
  private async generateEnhancedSummaryReport(results: EnhancedGenerationSummary, config: EnhancedGenerationConfig): Promise<void> {
    const report = {
      generatedAt: new Date().toISOString(),
      config: {
        dateRange: `${config.startDate} to ${config.endDate}`,
        puzzlesPerDay: config.puzzlesPerDay,
        qualityThreshold: config.qualityThreshold,
        outputDirectory: config.outputDir,
        geminiEnabled: config.useGemini,
        algorithm: config.useGemini ? 'Gemini + Local Hybrid' : 'Local Vector Similarity'
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
      enhancementStats: {
        geminiEnhanced: results.enhancementStats.geminiEnhanced,
        localFallback: results.enhancementStats.localFallback,
        enhancementSuccessRate: `${(results.enhancementStats.enhancementSuccessRate * 100).toFixed(1)}%`,
        totalCategories: results.enhancementStats.geminiEnhanced + results.enhancementStats.localFallback
      },
      failedDates: results.failedDates,
      importInstructions: {
        firebase: "Import JSON file using Firebase Console > Realtime Database > Import JSON",
        structure: "Enhanced puzzles are stored under dailyPuzzles/enhanced/{date}",
        validation: "Review enhanced puzzle quality and test gameplay before importing to production",
        paths: {
          puzzleData: "dailyPuzzles/enhanced/{date}",
          puzzleIndex: "puzzleIndex/enhanced/{date}"
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

    const reportPath = path.join(config.outputDir, 'enhanced_generation_report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`\n📋 Enhanced Summary Report:`);
    console.log(`   📊 Success: ${results.successfulDates}/${results.totalDates} dates (${((results.successfulDates / results.totalDates) * 100).toFixed(1)}%)`);
    console.log(`   🎮 Puzzles: ${results.totalPuzzles} total`);
    console.log(`   ⭐ Quality: ${results.avgQuality.toFixed(3)} average`);
    console.log(`   🤖 Gemini: ${results.enhancementStats.geminiEnhanced} enhanced, ${results.enhancementStats.localFallback} local`);
    console.log(`   📈 Enhancement Success: ${(results.enhancementStats.enhancementSuccessRate * 100).toFixed(1)}%`);
    console.log(`   ⏱️  Time: ${(results.processingTime / 1000).toFixed(1)}s`);
    console.log(`   📄 Report: ${reportPath}`);
    
    if (results.failedDates.length > 0) {
      console.log(`   ❌ Failed: ${results.failedDates.join(', ')}`);
    }
  }

  /**
   * Save combined Firebase data to single JSON file
   */
  private async saveCombinedFirebaseFile(firebaseData: Record<string, any>, config: EnhancedGenerationConfig): Promise<void> {
    const filename = path.join(config.outputDir, 'enhanced_firebase_import.json');
    await fs.writeFile(filename, JSON.stringify(firebaseData, null, 2));
    
    console.log(`\n💾 Enhanced Firebase file saved: ${filename}`);
    console.log(`📊 Contains enhanced data for ${Object.keys(firebaseData.dailyPuzzles?.enhanced || {}).length} dates`);
    console.log(`🔥 Ready for Firebase RTDB import!`);
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

  const config: EnhancedGenerationConfig = {
    startDate: args[0] || '2025-08-05',
    endDate: args[1] || '2025-08-11',
    puzzlesPerDay: parseInt(args[2]) || 7,
    qualityThreshold: parseFloat(args[3]) || 0.5,
    outputDir: args[4] || './enhanced-puzzles',
    maxAttemptsPerDay: parseInt(args[5]) || 5,
    verbose: args.includes('--verbose') || args.includes('-v'),
    useGemini: args.includes('--gemini') || args.includes('-g'),
    geminiApiKey: process.env.GEMINI_API_KEY,
    wikiCategoriesPath: args.includes('--wiki') ? args[args.indexOf('--wiki') + 1] : undefined
  };

  console.log('🚀 Initializing Enhanced Puzzle Generation System...');
  console.log('📊 Configuration:');
  console.log(`   📅 Date Range: ${config.startDate} to ${config.endDate}`);
  console.log(`   🎲 Puzzles/Day: ${config.puzzlesPerDay}`);
  console.log(`   ⭐ Quality Threshold: ${config.qualityThreshold}`);
  console.log(`   📁 Output: ${config.outputDir}`);
  console.log(`   🤖 Gemini: ${config.useGemini ? 'ENABLED' : 'DISABLED'}`);
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

    // Setup Gemini configuration if enabled
    let geminiConfig: GeminiConfig | undefined;
    if (config.useGemini) {
      if (!config.geminiApiKey) {
        console.warn('⚠️ GEMINI_API_KEY not found, disabling Gemini enhancement');
        config.useGemini = false;
      } else {
        geminiConfig = {
          apiKey: config.geminiApiKey,
          modelId: 'gemini-embedding-001',
          embeddingDimension: 3072,
          taskType: 'SEMANTIC_SIMILARITY'
        };
        console.log('🤖 Gemini configuration loaded');
      }
    }

    // Setup Wiki theme configuration if provided
    let wikiConfig: WikiThemeConfig | undefined;
    if (config.wikiCategoriesPath) {
      wikiConfig = {
        categoriesPath: config.wikiCategoriesPath,
        excludeCategories: ['General reference', 'Research', 'Academic disciplines'],
        minThemeLength: 3
      };
      console.log(`📚 Wiki categories loaded from ${config.wikiCategoriesPath}`);
    }

    // Initialize enhanced puzzle generator
    console.log('\n🎯 Starting enhanced puzzle generation...');
    const puzzleGenerator = new GeminiEnhancedPuzzleGenerator(vectorLoader, geminiConfig, wikiConfig);
    const script = new EnhancedPuzzleGenerationScript(vectorLoader, puzzleGenerator);

    // Generate puzzles
    const results = await script.generateDateRange(config);
    
    console.log('\n✨ Enhanced Generation Complete!');
    
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
📚 Enhanced Puzzle Generator - Gemini + Local Hybrid Algorithm

Usage:
  npm run generate:enhanced [startDate] [endDate] [puzzlesPerDay] [qualityThreshold] [outputDir] [maxAttempts] [options]

Arguments:
  startDate        Start date (YYYY-MM-DD) [default: 2025-08-05]
  endDate          End date (YYYY-MM-DD) [default: 2025-08-11]
  puzzlesPerDay    Number of puzzles per day [default: 7] - Generates sizes 4x4 through 10x10
  qualityThreshold Minimum quality score (0-1) [default: 0.5]
  outputDir        Output directory [default: ./enhanced-puzzles]
  maxAttempts      Max attempts per day [default: 5]

Options:
  --gemini, -g     Enable Gemini enhancement (requires GEMINI_API_KEY env var)
  --wiki PATH      Use Wikipedia categories from PATH for theme selection
  --verbose, -v    Verbose output with enhanced puzzle details
  --help, -h       Show this help message

Environment Variables:
  GEMINI_API_KEY   Required for Gemini enhancement

Examples:
  # Generate with local algorithm only
  npm run generate:enhanced 2025-08-05 2025-08-11

  # Generate with Gemini enhancement enabled
  GEMINI_API_KEY=your_key npm run generate:enhanced 2025-08-05 2025-08-11 --gemini

  # Generate with Wikipedia themes and verbose output
  npm run generate:enhanced 2025-08-05 2025-08-07 7 0.6 ./test-output --wiki ./wiki_categories.txt --verbose

Algorithm Features:
  🤖 Gemini Enhancement: Uses Google's Gemini embeddings for improved semantic similarity
  🔄 Hybrid Fallback: Falls back to local vector similarity if Gemini fails
  📚 Wikipedia Themes: Optional integration with Wikipedia categories
  📊 Enhanced Metadata: Tracks enhancement method and quality metrics per category
  🎯 Progressive Difficulty: Maintains original difficulty progression algorithm
`);
}

// Run CLI if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };