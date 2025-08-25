#!/usr/bin/env node

/**
 * Generate All Batches Script
 * Generates 80 4x4 puzzles using both algorithms and creates comparison analysis
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { WikiBatchGenerator, WikiBatchResult } from './generate-batch-wiki.js';
import { GeminiBatchGenerator, GeminiBatchResult } from './generate-batch-gemini.js';
import { FirebaseFormatConverter } from './firebase-format-converter.js';

export interface DvcStatusResult {
  wikiNeedsUpdate: boolean;
  geminiNeedsUpdate: boolean;
  wikiChanges: string[];
  geminiChanges: string[];
  statusMessage: string;
}

export interface BatchComparisonResult {
  totalPuzzles: number;
  wikiResults: WikiBatchResult;
  geminiResults: GeminiBatchResult;
  skippedPipelines: string[];
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
   * Commit DVC outputs for specific pipeline stages immediately after completion.
   * This ensures that if the script is interrupted or run again, completed 
   * pipelines won't need to be re-run unnecessarily.
   */
  private async commitDvcOutputs(pipelineName: string, pipelinePath: string, stages: string[]): Promise<boolean> {
    console.log(`💾 Committing DVC stages for ${pipelineName} pipeline: ${stages.join(', ')}`);
    
    return new Promise((resolve) => {
      // First try without force, then with force if needed
      const dvcArgs = ['commit', ...stages];
      const dvcProcess = spawn('dvc', dvcArgs, {
        cwd: pipelinePath,
        stdio: 'pipe',
        env: process.env
      });
      
      let errorOutput = '';
      let stdoutOutput = '';
      
      dvcProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        stdoutOutput += text;
        if (this.verbose && text.trim()) {
          console.log(`   📝 ${text.trim()}`);
        }
      });
      
      dvcProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        if (this.verbose && text.trim()) {
          console.log(`   📝 ${text.trim()}`);
        }
      });
      
      dvcProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ ${pipelineName} outputs committed to DVC successfully`);
          resolve(true);
        } else {
          console.warn(`⚠️  Initial DVC commit failed for ${pipelineName} (exit code: ${code})`);
          if (this.verbose && errorOutput.trim()) {
            console.warn(`   Error: ${errorOutput.trim()}`);
          }
          
          // Retry with --force if the initial commit failed due to dependency issues
          if (errorOutput.includes('Use `-f|--force` to force')) {
            console.log(`   🔄 Retrying with --force...`);
            
            const forceArgs = ['commit', '--force', ...stages];
            const forceProcess = spawn('dvc', forceArgs, {
              cwd: pipelinePath,
              stdio: 'pipe',
              env: process.env
            });
            
            let forceError = '';
            forceProcess.stderr?.on('data', (data) => {
              forceError += data.toString();
            });
            
            forceProcess.on('close', (forceCode) => {
              if (forceCode === 0) {
                console.log(`✅ ${pipelineName} outputs committed to DVC successfully (with force)`);
                resolve(true);
              } else {
                console.warn(`⚠️  DVC commit failed even with --force for ${pipelineName} (exit code: ${forceCode})`);
                if (forceError.trim()) {
                  console.warn(`   Force error: ${forceError.trim()}`);
                }
                resolve(false);
              }
            });
          } else {
            // Don't retry if it's a different type of error
            resolve(false);
          }
        }
      });
    });
  }

  /**
   * Check DVC status to determine which pipelines need updates
   */
  private async checkDvcStatus(): Promise<DvcStatusResult> {
    const themesQualityPath = path.resolve('../datascience/themes_quality');
    
    console.log(`🔍 Checking DVC status to determine which pipelines need updates...`);
    
    return new Promise((resolve) => {
      const dvcProcess = spawn('dvc', ['status', '--verbose'], {
        cwd: themesQualityPath,
        stdio: 'pipe',
        env: process.env
      });
      
      let statusOutput = '';
      let errorOutput = '';
      
      dvcProcess.stdout?.on('data', (data) => {
        statusOutput += data.toString();
      });
      
      dvcProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      dvcProcess.on('close', (code) => {
        const allOutput = statusOutput + errorOutput;
        
        // Parse DVC status output to determine what needs updating
        const wikiChanges: string[] = [];
        const geminiChanges: string[] = [];
        
        // Check for wiki pipeline changes
        if (allOutput.includes('wiki_puzzle_pipeline/dvc.yaml:')) {
          const wikiMatches = allOutput.match(/wiki_puzzle_pipeline\/dvc\.yaml:[\s\S]*?(?=\n\n|\n[a-zA-Z]|$)/g);
          if (wikiMatches) {
            wikiMatches.forEach(match => wikiChanges.push(match.trim()));
          }
        }
        
        // Check for gemini pipeline changes  
        if (allOutput.includes('wiki_puzzle_gemini_pipeline/dvc.yaml:')) {
          const geminiMatches = allOutput.match(/wiki_puzzle_gemini_pipeline\/dvc\.yaml:[\s\S]*?(?=\n\n|\n[a-zA-Z]|$)/g);
          if (geminiMatches) {
            geminiMatches.forEach(match => geminiChanges.push(match.trim()));
          }
        }
        
        const wikiNeedsUpdate = wikiChanges.length > 0;
        const geminiNeedsUpdate = geminiChanges.length > 0;
        
        // If no specific pipeline changes detected but we have output, something needs updating
        const hasAnyChanges = allOutput.trim() !== '' && !allOutput.includes('Data and pipelines are up to date');
        
        console.log(`📊 DVC Status Analysis:`);
        console.log(`   Wiki Pipeline: ${wikiNeedsUpdate ? '🔄 Needs Update' : '✅ Up to Date'}`);
        console.log(`   Gemini Pipeline: ${geminiNeedsUpdate ? '🔄 Needs Update' : '✅ Up to Date'}`);
        
        if (wikiChanges.length > 0) {
          console.log(`   Wiki changes: ${wikiChanges.length} detected`);
        }
        if (geminiChanges.length > 0) {
          console.log(`   Gemini changes: ${geminiChanges.length} detected`);
        }
        
        resolve({
          wikiNeedsUpdate: wikiNeedsUpdate || (hasAnyChanges && !geminiNeedsUpdate),
          geminiNeedsUpdate: geminiNeedsUpdate || (hasAnyChanges && !wikiNeedsUpdate),
          wikiChanges,
          geminiChanges,
          statusMessage: allOutput
        });
      });
    });
  }

  /**
   * Generate both sets of 80 4x4 puzzles and create comparison analysis
   */
  async generateAllBatches(): Promise<BatchComparisonResult> {
    const startTime = Date.now();
    
    console.log(`🎯 Starting generation of both puzzle sets...`);
    console.log(`📁 Base output directory: ${this.baseOutputDir}`);
    
    // Check DVC status to determine what needs updating
    const dvcStatus = await this.checkDvcStatus();
    
    // Ensure base output directory exists
    await fs.mkdir(this.baseOutputDir, { recursive: true });
    
    const wikiOutputDir = path.join(this.baseOutputDir, 'set1-wiki-pipeline');
    const geminiOutputDir = path.join(this.baseOutputDir, 'set2-gemini-pipeline');
    
    let wikiResults: WikiBatchResult;
    let geminiResults: GeminiBatchResult;
    const skippedPipelines: string[] = [];
    
    // Conditionally generate Wiki pipeline puzzles
    if (dvcStatus.wikiNeedsUpdate) {
      console.log(`\n🔄 Step 1: Generating Wiki pipeline puzzles...`);
      const wikiGenerator = new WikiBatchGenerator({
        outputDir: wikiOutputDir,
        verbose: this.verbose
      });
      wikiResults = await wikiGenerator.generateBatch();
      
      if (!wikiResults.success) {
        console.error(`❌ Wiki pipeline failed: ${wikiResults.error}`);
      } else {
        console.log(`✅ Wiki pipeline: ${wikiResults.puzzleCount} puzzles generated`);
        
        // Immediately commit DVC outputs for wiki pipeline
        const wikiPipelinePath = path.resolve('../datascience/themes_quality/wiki_puzzle_pipeline');
        const wikiStages = ['dvc.yaml:select_themes', 'dvc.yaml:generate_puzzles'];
        await this.commitDvcOutputs('Wiki', wikiPipelinePath, wikiStages);
      }
    } else {
      console.log(`\n⏭️  Step 1: Skipping Wiki pipeline (no changes detected)`);
      skippedPipelines.push('wiki');
      // Create a placeholder result for skipped pipeline
      wikiResults = {
        success: true,
        puzzleCount: 0,
        outputPath: wikiOutputDir,
        processingTime: 0,
        metadata: { skipped: true, reason: 'No DVC changes detected' }
      };
    }
    
    // Conditionally generate Gemini pipeline puzzles
    if (dvcStatus.geminiNeedsUpdate) {
      console.log(`\n🔄 Step 2: Generating Gemini pipeline puzzles...`);
      const geminiGenerator = new GeminiBatchGenerator({
        outputDir: geminiOutputDir,
        verbose: this.verbose
      });
      geminiResults = await geminiGenerator.generateBatch();
      
      if (!geminiResults.success) {
        console.error(`❌ Gemini pipeline failed: ${geminiResults.error}`);
      } else {
        console.log(`✅ Gemini pipeline: ${geminiResults.puzzleCount} puzzles generated`);
        
        // Immediately commit DVC outputs for gemini pipeline
        const geminiPipelinePath = path.resolve('../datascience/themes_quality/wiki_puzzle_gemini_pipeline');
        const geminiStages = ['dvc.yaml:select_themes', 'dvc.yaml:select_candidates', 'dvc.yaml:enhance_with_gemini'];
        await this.commitDvcOutputs('Gemini', geminiPipelinePath, geminiStages);
      }
    } else {
      console.log(`\n⏭️  Step 2: Skipping Gemini pipeline (no changes detected)`);
      skippedPipelines.push('gemini');
      // Create a placeholder result for skipped pipeline
      geminiResults = {
        success: true,
        puzzleCount: 0,
        outputPath: geminiOutputDir,
        processingTime: 0,
        metadata: { skipped: true, reason: 'No DVC changes detected' }
      };
    }
    
    // Create comparison analysis
    console.log(`\n📊 Step 3: Creating comparison analysis...`);
    const comparison = await this.createComparisonAnalysis(wikiResults, geminiResults);
    
    // Generate unified Firebase format
    console.log(`\n🔄 Step 4: Creating unified Firebase format...`);
    await this.createUnifiedFirebaseFormat(wikiOutputDir, geminiOutputDir);
    
    // Final DVC commit at the themes_quality level to catch any remaining changes
    if (dvcStatus.wikiNeedsUpdate || dvcStatus.geminiNeedsUpdate) {
      console.log(`\n💾 Final DVC commit for overall themes_quality changes...`);
      const themesQualityPath = path.resolve('../datascience/themes_quality');
      // For the parent level, we'll commit all pipeline stages that were executed
      const allStages: string[] = [];
      if (dvcStatus.wikiNeedsUpdate) {
        allStages.push('wiki_puzzle_pipeline/dvc.yaml:select_themes', 'wiki_puzzle_pipeline/dvc.yaml:generate_puzzles');
      }
      if (dvcStatus.geminiNeedsUpdate) {
        allStages.push('wiki_puzzle_gemini_pipeline/dvc.yaml:select_themes', 'wiki_puzzle_gemini_pipeline/dvc.yaml:select_candidates', 'wiki_puzzle_gemini_pipeline/dvc.yaml:enhance_with_gemini');
      }
      await this.commitDvcOutputs('themes_quality', themesQualityPath, allStages);
    }
    
    const totalProcessingTime = Date.now() - startTime;
    
    const result: BatchComparisonResult = {
      totalPuzzles: wikiResults.puzzleCount + geminiResults.puzzleCount,
      wikiResults,
      geminiResults,
      skippedPipelines,
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
    if (skippedPipelines.length > 0) {
      console.log(`⏭️  Skipped pipelines: ${skippedPipelines.join(', ')} (no changes)`);
    }
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
          error: wikiResults.error,
          skipped: wikiResults.metadata?.skipped || false,
          skipReason: wikiResults.metadata?.reason
        },
        gemini_pipeline: {
          success: geminiResults.success,
          puzzleCount: geminiResults.puzzleCount,
          processingTime: geminiResults.processingTime,
          avgTimePerPuzzle: geminiResults.puzzleCount > 0 ? 
            geminiResults.processingTime / geminiResults.puzzleCount : 0,
          error: geminiResults.error,
          skipped: geminiResults.metadata?.skipped || false,
          skipReason: geminiResults.metadata?.reason
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
        wiki_output_ratio: wikiResults.puzzleCount / 80,
        gemini_output_ratio: geminiResults.puzzleCount / 80,
        both_successful: wikiResults.success && geminiResults.success
      },
      generatedAt: new Date().toISOString(),
      target: {
        expected_puzzles_per_set: 80,
        expected_puzzle_format: '4x4',
        expected_total_puzzles: 160
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
        skippedSets: result.skippedPipelines,
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
  const wikiStatus = result.skippedPipelines.includes('wiki') ? '⏭️  Skipped' : 
                    (result.wikiResults.success ? '✅' : '❌');
  const geminiStatus = result.skippedPipelines.includes('gemini') ? '⏭️  Skipped' : 
                      (result.geminiResults.success ? '✅' : '❌');
  
  console.log(`   Wiki Pipeline: ${wikiStatus} ${result.wikiResults.puzzleCount} puzzles`);
  console.log(`   Gemini Pipeline: ${geminiStatus} ${result.geminiResults.puzzleCount} puzzles`);
  console.log(`   Total: ${result.totalPuzzles} puzzles`);
  console.log(`   Results: ${outputDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { AllBatchesGenerator };