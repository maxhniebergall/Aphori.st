#!/usr/bin/env node

/**
 * Batch Gemini Pipeline Generator
 * Generates 80 4x4 puzzles using the wiki_puzzle_gemini_pipeline algorithm
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { FirebaseFormatConverter } from './firebase-format-converter.js';

export interface GeminiBatchConfig {
  outputDir: string;
  verbose: boolean;
  multiprocessing?: boolean;  // Enable/disable multiprocessing
}

export interface GeminiBatchResult {
  success: boolean;
  puzzleCount: number;
  outputPath: string;
  processingTime: number;
  metadata: any;
  error?: string;
}

class GeminiBatchGenerator {
  constructor(private config: GeminiBatchConfig) {}

  /**
   * Generate 80 4x4 puzzles using gemini pipeline (with multiprocessing support)
   */
  async generateBatch(): Promise<GeminiBatchResult> {
    const startTime = Date.now();
    
    console.log(`🔄 Starting Gemini pipeline batch generation...`);
    console.log(`📁 Output directory: ${this.config.outputDir}`);
    console.log(`⚡ Multiprocessing: ${this.config.multiprocessing ? 'enabled' : 'disabled'}`);
    
    const steps = [
      'Setup and validation',
      'Running Gemini pipeline',
      'Converting pipeline output',
      'Generating Firebase format'
    ];
    
    try {
      // Step 1: Setup
      console.log(`\n📋 [████░░░░░░] 40% (1/${steps.length}) ${steps[0]}`);
      await fs.mkdir(this.config.outputDir, { recursive: true });
      
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY environment variable is required');
      }
      
      // Step 2: Run pipeline
      console.log(`📋 [██████░░░░] 60% (2/${steps.length}) ${steps[1]}`);
      const pipelineResult = await this.runGeminiPipeline();
      
      if (!pipelineResult.success) {
        throw new Error(`Gemini pipeline failed: ${pipelineResult.error}`);
      }
      
      // Step 3: Convert output
      console.log(`📋 [████████░░] 80% (3/${steps.length}) ${steps[2]}`);
      const convertResult = await this.convertPipelineOutput();
      
      // Step 4: Generate Firebase format
      console.log(`📋 [██████████] 100% (4/${steps.length}) ${steps[3]}`);
      await this.generateFirebaseFormat();
      
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Gemini batch generation completed in ${processingTime}ms`);
      console.log(`📊 Generated ${convertResult.puzzleCount} puzzles`);
      
      return {
        success: true,
        puzzleCount: convertResult.puzzleCount,
        outputPath: this.config.outputDir,
        processingTime,
        metadata: convertResult.metadata
      };
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      console.error(`❌ Gemini batch generation failed: ${errorMessage}`);
      
      return {
        success: false,
        puzzleCount: 0,
        outputPath: this.config.outputDir,
        processingTime,
        metadata: null,
        error: errorMessage
      };
    }
  }

  /**
   * Run the Gemini puzzle pipeline using DVC (with multiprocessing support)
   */
  private async runGeminiPipeline(): Promise<{ success: boolean; error?: string }> {
    const pipelinePath = path.resolve('../datascience/themes_quality/wiki_puzzle_gemini_pipeline');
    
    console.log(`🚀 Running Gemini puzzle pipeline from ${pipelinePath}`);
    
    return new Promise((resolve) => {
      // Check if DVC is available
      if (!this.checkDvcAvailable()) {
        console.error(`❌ DVC is not installed. Please install DVC: pip install dvc`);
        resolve({ success: false, error: 'DVC not installed' });
        return;
      }

      // First try to pull existing cache files
      console.log(`🔄 Attempting to restore cache from DVC...`);
      const dvcPull = spawnSync('dvc', ['pull', 'data/cache/all_embeddings.csv'], {
        cwd: pipelinePath,
        stdio: 'pipe',
        env: { ...process.env, GEMINI_API_KEY: process.env.GEMINI_API_KEY }
      });
      
      if (dvcPull.status === 0) {
        console.log(`✅ Cache restored from DVC`);
      } else {
        console.log(`ℹ️  No existing cache in DVC, will start fresh`);
      }

      // Set up environment for pipeline execution
      const pipelineEnv = { 
        ...process.env, 
        GEMINI_API_KEY: process.env.GEMINI_API_KEY 
      };

      // Configure multiprocessing if specified
      if (this.config.multiprocessing !== undefined) {
        // The multiprocessing setting will be read from params.yaml
        // Could potentially override here in the future if needed
        console.log(`🔧 Multiprocessing preference: ${this.config.multiprocessing ? 'enabled' : 'disabled'}`);
      }

      // Run the DVC pipeline with verbose output to see progress
      const dvcProcess = spawn('dvc', ['repro', '--verbose'], {
        cwd: pipelinePath,
        stdio: 'pipe', // Always capture output to show progress
        env: pipelineEnv
      });
      
      let errorOutput = '';
      let stdoutOutput = '';
      
      // Add periodic "still working" indicator
      const progressInterval = setInterval(() => {
        console.log(`   🔄 Gemini pipeline still running... (using API tokens)`);
      }, 30000); // Every 30 seconds
      
      dvcProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        stdoutOutput += text;
        // Show DVC output immediately for progress
        if (text.trim()) {
          console.log(`   📝 ${text.trim()}`);
        }
      });
      
      dvcProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        // Show any error output immediately
        if (text.trim()) {
          console.log(`   📝 ${text.trim()}`);
        }
      });
      
      dvcProcess.on('close', (code) => {
        clearInterval(progressInterval);
        if (code === 0) {
          console.log(`✅ Gemini pipeline completed successfully`);
          resolve({ success: true });
        } else {
          console.error(`❌ Gemini pipeline failed with exit code ${code}`);
          if (errorOutput) {
            console.error(`   Error output: ${errorOutput}`);
          }
          if (stdoutOutput) {
            console.log(`   Standard output: ${stdoutOutput}`);
          }
          resolve({ success: false, error: errorOutput || `Exit code ${code}` });
        }
      });
      
      dvcProcess.on('error', (error) => {
        console.error(`❌ Gemini pipeline process error: ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * Convert pipeline output to our format and copy to output directory
   */
  private async convertPipelineOutput(): Promise<{ puzzleCount: number; metadata: any }> {
    const pipelinePath = path.resolve('../datascience/themes_quality/wiki_puzzle_gemini_pipeline');
    const puzzlesPath = path.join(pipelinePath, 'data/outputs/final_puzzles.json');
    const metadataPath = path.join(pipelinePath, 'data/outputs/puzzle_metadata.json');
    
    // Read the generated files
    const puzzlesData = await fs.readFile(puzzlesPath, 'utf-8');
    const puzzles = JSON.parse(puzzlesData);
    
    let metadata = {};
    try {
      const metadataData = await fs.readFile(metadataPath, 'utf-8');
      metadata = JSON.parse(metadataData);
    } catch (error) {
      console.log(`⚠️  No metadata file found, proceeding without it`);
    }
    
    // Copy files to our output directory
    const outputPuzzlesPath = path.join(this.config.outputDir, 'puzzles.json');
    const outputMetadataPath = path.join(this.config.outputDir, 'metadata.json');
    
    await fs.writeFile(outputPuzzlesPath, puzzlesData);
    await fs.writeFile(outputMetadataPath, JSON.stringify(metadata, null, 2));
    
    // Create a summary file
    const puzzleCount = Object.keys(puzzles).length;
    const summary = {
      algorithm: 'wiki_puzzle_gemini_pipeline',
      generatedAt: new Date().toISOString(),
      puzzleCount: puzzleCount,
      sourceFiles: {
        puzzles: puzzlesPath,
        metadata: metadataPath
      },
      outputFiles: {
        puzzles: outputPuzzlesPath,
        metadata: outputMetadataPath
      },
      metadata: metadata
    };
    
    await fs.writeFile(
      path.join(this.config.outputDir, 'summary.json'),
      JSON.stringify(summary, null, 2)
    );
    
    console.log(`📁 Files copied to ${this.config.outputDir}`);
    
    return {
      puzzleCount: puzzleCount,
      metadata: summary
    };
  }

  /**
   * Generate Firebase format output
   */
  private async generateFirebaseFormat(): Promise<void> {
    console.log(`🔄 Converting to Firebase format...`);
    
    const converter = new FirebaseFormatConverter();
    const dateStamp = new Date().toISOString().split('T')[0];
    const setName = `gemini_batch_${dateStamp}`;
    const firebaseOutputPath = path.join(this.config.outputDir, 'firebase-format.json');
    
    await converter.convertBatchToFirebase(
      this.config.outputDir,
      'wiki_puzzle_gemini_pipeline',
      firebaseOutputPath,
      setName
    );
    
    console.log(`💾 Firebase format saved to: ${firebaseOutputPath}`);
    console.log(`🏷️  Set name: ${setName}`);
  }

  /**
   * Check if DVC is available in the system
   */
  private checkDvcAvailable(): boolean {
    try {
      const result = spawnSync('dvc', ['--version'], { stdio: 'pipe' });
      return result.status === 0;
    } catch (error) {
      return false;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outputDir = args[0] || './batch-output/set2-gemini-pipeline';
  const verbose = args.includes('--verbose');
  const multiprocessing = args.includes('--multiprocessing') || args.includes('--parallel');
  
  console.log(`🎯 Gemini Batch Generator`);
  console.log(`📁 Output: ${outputDir}`);
  console.log(`🔍 Verbose: ${verbose}`);
  console.log(`⚡ Multiprocessing: ${multiprocessing ? 'enabled' : 'default (from config)'}`);
  
  const generator = new GeminiBatchGenerator({ outputDir, verbose, multiprocessing });
  const result = await generator.generateBatch();
  
  if (!result.success) {
    console.error(`❌ Generation failed: ${result.error}`);
    process.exit(1);
  }
  
  console.log(`🎉 Successfully generated ${result.puzzleCount} puzzles in ${result.processingTime}ms`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { GeminiBatchGenerator };