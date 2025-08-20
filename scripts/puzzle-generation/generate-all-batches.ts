#!/usr/bin/env node

/**
 * Generate All Batches Script
 * Generates 100 4x4 puzzles using both algorithms and creates comparison analysis
 */

import fs from 'fs/promises';
import path from 'path';
import { WikiBatchGenerator, WikiBatchResult } from './generate-batch-wiki.js';
import { GeminiBatchGenerator, GeminiBatchResult } from './generate-batch-gemini.js';
import { FirebaseFormatConverter } from './firebase-format-converter.js';

export interface BatchComparisonResult {
  totalPuzzles: number;
  wikiResults: WikiBatchResult;
  geminiResults: GeminiBatchResult;
  comparison: {
    wikiPuzzleCount: number;
    geminiPuzzleCount: number;
    wikiProcessingTime: number;
    geminiProcessingTime: number;
    totalProcessingTime: number;
    successRate: {
      wiki: boolean;
      gemini: boolean;
      overall: number;
    };
  };
  outputPaths: {
    wiki: string;
    gemini: string;
    comparison: string;
  };
}

class AllBatchesGenerator {
  private baseOutputDir: string;
  private verbose: boolean;

  constructor(baseOutputDir: string = './batch-output', verbose: boolean = false) {
    this.baseOutputDir = baseOutputDir;
    this.verbose = verbose;
  }

  /**
   * Generate both sets of 100 4x4 puzzles and create comparison analysis
   */
  async generateAllBatches(): Promise<BatchComparisonResult> {
    const startTime = Date.now();
    
    console.log(`🎯 Starting generation of both puzzle sets...`);
    console.log(`📁 Base output directory: ${this.baseOutputDir}`);
    
    // Ensure base output directory exists
    await fs.mkdir(this.baseOutputDir, { recursive: true });
    
    const wikiOutputDir = path.join(this.baseOutputDir, 'set1-wiki-pipeline');
    const geminiOutputDir = path.join(this.baseOutputDir, 'set2-gemini-pipeline');
    
    // Generate Wiki pipeline puzzles
    console.log(`\n🔄 Step 1: Generating Wiki pipeline puzzles...`);
    const wikiGenerator = new WikiBatchGenerator({
      outputDir: wikiOutputDir,
      verbose: this.verbose
    });
    const wikiResults = await wikiGenerator.generateBatch();
    
    if (!wikiResults.success) {
      console.error(`❌ Wiki pipeline failed: ${wikiResults.error}`);
    } else {
      console.log(`✅ Wiki pipeline: ${wikiResults.puzzleCount} puzzles generated`);
    }
    
    // Generate Gemini pipeline puzzles
    console.log(`\n🔄 Step 2: Generating Gemini pipeline puzzles...`);
    const geminiGenerator = new GeminiBatchGenerator({
      outputDir: geminiOutputDir,
      verbose: this.verbose
    });
    const geminiResults = await geminiGenerator.generateBatch();
    
    if (!geminiResults.success) {
      console.error(`❌ Gemini pipeline failed: ${geminiResults.error}`);
    } else {
      console.log(`✅ Gemini pipeline: ${geminiResults.puzzleCount} puzzles generated`);
    }
    
    // Create comparison analysis
    console.log(`\n📊 Step 3: Creating comparison analysis...`);
    const comparison = await this.createComparisonAnalysis(wikiResults, geminiResults);
    
    // Generate unified Firebase format
    console.log(`\n🔄 Step 4: Creating unified Firebase format...`);
    await this.createUnifiedFirebaseFormat(wikiOutputDir, geminiOutputDir);
    
    const totalProcessingTime = Date.now() - startTime;
    
    const result: BatchComparisonResult = {
      totalPuzzles: wikiResults.puzzleCount + geminiResults.puzzleCount,
      wikiResults,
      geminiResults,
      comparison: {
        wikiPuzzleCount: wikiResults.puzzleCount,
        geminiPuzzleCount: geminiResults.puzzleCount,
        wikiProcessingTime: wikiResults.processingTime,
        geminiProcessingTime: geminiResults.processingTime,
        totalProcessingTime,
        successRate: {
          wiki: wikiResults.success,
          gemini: geminiResults.success,
          overall: (wikiResults.success && geminiResults.success) ? 1.0 : 
                   (wikiResults.success || geminiResults.success) ? 0.5 : 0.0
        }
      },
      outputPaths: {
        wiki: wikiOutputDir,
        gemini: geminiOutputDir,
        comparison: path.join(this.baseOutputDir, 'comparison-report.json')
      }
    };
    
    // Save overall results
    await this.saveOverallResults(result);
    
    console.log(`\n🎉 All batches completed!`);
    console.log(`📊 Total puzzles: ${result.totalPuzzles}`);
    console.log(`⏱️  Total time: ${totalProcessingTime}ms`);
    console.log(`📁 Results saved to: ${this.baseOutputDir}`);
    
    return result;
  }

  /**
   * Create detailed comparison analysis between the two algorithms
   */
  private async createComparisonAnalysis(
    wikiResults: WikiBatchResult,
    geminiResults: GeminiBatchResult
  ) {
    const comparison = {
      algorithms: {
        wiki_pipeline: {
          success: wikiResults.success,
          puzzleCount: wikiResults.puzzleCount,
          processingTime: wikiResults.processingTime,
          avgTimePerPuzzle: wikiResults.puzzleCount > 0 ? 
            wikiResults.processingTime / wikiResults.puzzleCount : 0,
          error: wikiResults.error
        },
        gemini_pipeline: {
          success: geminiResults.success,
          puzzleCount: geminiResults.puzzleCount,
          processingTime: geminiResults.processingTime,
          avgTimePerPuzzle: geminiResults.puzzleCount > 0 ? 
            geminiResults.processingTime / geminiResults.puzzleCount : 0,
          error: geminiResults.error
        }
      },
      performance: {
        faster_algorithm: wikiResults.processingTime < geminiResults.processingTime ? 'wiki' : 'gemini',
        time_difference: Math.abs(wikiResults.processingTime - geminiResults.processingTime),
        time_ratio: wikiResults.processingTime > 0 && geminiResults.processingTime > 0 ?
          Math.max(wikiResults.processingTime, geminiResults.processingTime) /
          Math.min(wikiResults.processingTime, geminiResults.processingTime) : null
      },
      output: {
        total_puzzles: wikiResults.puzzleCount + geminiResults.puzzleCount,
        wiki_output_ratio: wikiResults.puzzleCount / 100,
        gemini_output_ratio: geminiResults.puzzleCount / 100,
        both_successful: wikiResults.success && geminiResults.success
      },
      generatedAt: new Date().toISOString(),
      target: {
        expected_puzzles_per_set: 100,
        expected_puzzle_format: '4x4',
        expected_total_puzzles: 200
      }
    };
    
    // Save comparison analysis
    const comparisonPath = path.join(this.baseOutputDir, 'comparison-report.json');
    await fs.writeFile(
      comparisonPath,
      JSON.stringify(comparison, null, 2)
    );
    
    console.log(`📈 Comparison analysis saved to: ${comparisonPath}`);
    
    return comparison;
  }

  /**
   * Save overall batch generation results
   */
  private async saveOverallResults(result: BatchComparisonResult) {
    const overallResults = {
      summary: {
        generatedAt: new Date().toISOString(),
        totalPuzzles: result.totalPuzzles,
        targetPuzzles: 200,
        successfulSets: [
          result.wikiResults.success ? 'wiki_pipeline' : null,
          result.geminiResults.success ? 'gemini_pipeline' : null
        ].filter(Boolean),
        processingTime: result.comparison.totalProcessingTime
      },
      setResults: {
        set1_wiki: {
          algorithm: 'wiki_puzzle_pipeline',
          success: result.wikiResults.success,
          puzzleCount: result.wikiResults.puzzleCount,
          outputPath: result.outputPaths.wiki,
          processingTime: result.wikiResults.processingTime,
          error: result.wikiResults.error
        },
        set2_gemini: {
          algorithm: 'wiki_puzzle_gemini_pipeline',
          success: result.geminiResults.success,
          puzzleCount: result.geminiResults.puzzleCount,
          outputPath: result.outputPaths.gemini,
          processingTime: result.geminiResults.processingTime,
          error: result.geminiResults.error
        }
      },
      files: {
        comparisonReport: result.outputPaths.comparison,
        wikiPuzzles: path.join(result.outputPaths.wiki, 'puzzles.json'),
        geminiPuzzles: path.join(result.outputPaths.gemini, 'puzzles.json'),
        wikiMetadata: path.join(result.outputPaths.wiki, 'metadata.json'),
        geminiMetadata: path.join(result.outputPaths.gemini, 'metadata.json')
      }
    };
    
    const overallPath = path.join(this.baseOutputDir, 'batch-results.json');
    await fs.writeFile(
      overallPath,
      JSON.stringify(overallResults, null, 2)
    );
    
    console.log(`📋 Overall results saved to: ${overallPath}`);
  }

  /**
   * Create unified Firebase format from both batches
   */
  private async createUnifiedFirebaseFormat(
    wikiOutputDir: string,
    geminiOutputDir: string
  ): Promise<void> {
    const converter = new FirebaseFormatConverter();
    const dateStamp = new Date().toISOString().split('T')[0];
    const wikiSetName = `wiki_batch_${dateStamp}`;
    const geminiSetName = `gemini_batch_${dateStamp}`;
    const unifiedOutputPath = path.join(this.baseOutputDir, 'unified-firebase-puzzles.json');
    
    try {
      await converter.convertBothBatches(
        wikiOutputDir,
        geminiOutputDir,
        unifiedOutputPath,
        wikiSetName,
        geminiSetName
      );
      
      console.log(`🎯 Unified Firebase format created: ${unifiedOutputPath}`);
      console.log(`🏷️  Set names: ${wikiSetName}, ${geminiSetName}`);
      
    } catch (error) {
      console.error(`⚠️  Firebase format creation failed: ${error}`);
      console.log(`Individual Firebase formats are still available in each batch directory`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outputDir = args[0] || './batch-output';
  const verbose = args.includes('--verbose');
  
  console.log(`🎯 All Batches Generator`);
  console.log(`📁 Output: ${outputDir}`);
  console.log(`🔍 Verbose: ${verbose}`);
  
  const generator = new AllBatchesGenerator(outputDir, verbose);
  const result = await generator.generateAllBatches();
  
  if (result.comparison.successRate.overall === 0) {
    console.error(`❌ Both algorithms failed`);
    process.exit(1);
  } else if (result.comparison.successRate.overall < 1) {
    console.warn(`⚠️  Only partial success: ${result.comparison.successRate.overall * 100}%`);
  }
  
  console.log(`\n📊 Final Summary:`);
  console.log(`   Wiki Pipeline: ${result.wikiResults.success ? '✅' : '❌'} ${result.wikiResults.puzzleCount} puzzles`);
  console.log(`   Gemini Pipeline: ${result.geminiResults.success ? '✅' : '❌'} ${result.geminiResults.puzzleCount} puzzles`);
  console.log(`   Total: ${result.totalPuzzles} puzzles`);
  console.log(`   Results: ${outputDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { AllBatchesGenerator };