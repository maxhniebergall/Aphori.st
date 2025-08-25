#!/usr/bin/env node

/**
 * Batch Wiki Pipeline Generator
 * Generates 80 4x4 puzzles using the wiki_puzzle_pipeline algorithm
 */

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { FullVectorLoader } from './FullVectorLoader.js';
import { FirebaseFormatConverter } from './firebase-format-converter.js';

export interface WikiBatchConfig {
  outputDir: string;
  verbose: boolean;
}

export interface WikiBatchResult {
  success: boolean;
  puzzleCount: number;
  outputPath: string;
  processingTime: number;
  metadata: any;
  error?: string;
}

class WikiBatchGenerator {
  constructor(private config: WikiBatchConfig) {}

  /**
   * Generate 80 4x4 puzzles using wiki pipeline
   */
  async generateBatch(): Promise<WikiBatchResult> {
    const startTime = Date.now();
    
    console.log(`🔄 Starting wiki pipeline batch generation...`);
    console.log(`📁 Output directory: ${this.config.outputDir}`);
    
    const steps = [
      'Setup directory',
      'Running Wiki pipeline',
      'Converting pipeline output',
      'Generating Firebase format'
    ];
    
    try {
      // Step 1: Setup
      console.log(`\n📋 [████░░░░░░] 25% (1/${steps.length}) ${steps[0]}`);
      await fs.mkdir(this.config.outputDir, { recursive: true });
      
      // Step 2: Run pipeline
      console.log(`📋 [██████░░░░] 50% (2/${steps.length}) ${steps[1]}`);
      const pipelineResult = await this.runWikiPipeline();
      
      if (!pipelineResult.success) {
        throw new Error(`Wiki pipeline failed: ${pipelineResult.error}`);
      }
      
      // Step 3: Convert output
      console.log(`📋 [████████░░] 75% (3/${steps.length}) ${steps[2]}`);
      const convertResult = await this.convertPipelineOutput();
      
      // Step 4: Generate Firebase format
      console.log(`📋 [██████████] 100% (4/${steps.length}) ${steps[3]}`);
      await this.generateFirebaseFormat();
      
      const processingTime = Date.now() - startTime;
      
      console.log(`✅ Wiki batch generation completed in ${processingTime}ms`);
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
      
      console.error(`❌ Wiki batch generation failed: ${errorMessage}`);
      
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
   * Run the wiki puzzle pipeline Python script
   */
  private async runWikiPipeline(): Promise<{ success: boolean; error?: string }> {
    const pipelinePath = path.resolve('../datascience/themes_quality/wiki_puzzle_pipeline');
    
    console.log(`🐍 Running wiki puzzle pipeline from ${pipelinePath}`);
    
    // Check if the Python script exists
    const pythonScriptPath = path.join(pipelinePath, 'pipeline', 'puzzle_generator.py');
    try {
      await fs.access(pythonScriptPath);
    } catch (error) {
      return { success: false, error: `Python script not found: ${pythonScriptPath}` };
    }
    
    // Check if virtual environment exists
    const pythonPath = path.join(pipelinePath, 'venv', 'bin', 'python3');
    try {
      await fs.access(pythonPath);
    } catch (error) {
      return { success: false, error: `Python virtual environment not found: ${pythonPath}` };
    }
    
    console.log(`   ✅ Python script found: ${pythonScriptPath}`);
    console.log(`   ✅ Virtual environment found: ${pythonPath}`);
    console.log(`   ⏳ This may take several minutes... (generating many puzzles)`);
    
    return new Promise((resolve) => {
      // Use the virtual environment Python
      const pythonProcess = spawn('venv/bin/python3', ['-m', 'pipeline.puzzle_generator'], {
        cwd: pipelinePath,
        stdio: this.config.verbose ? 'inherit' : 'pipe'
      });
      
      let errorOutput = '';
      let stdoutOutput = '';
      
      // Add periodic "still working" indicator
      const progressInterval = setInterval(() => {
        console.log(`   🔄 Wiki pipeline still running...`);
      }, 30000); // Every 30 seconds
      
      if (!this.config.verbose) {
        pythonProcess.stderr?.on('data', (data) => {
          const text = data.toString();
          errorOutput += text;
          // Show any error output immediately
          if (text.trim()) {
            console.log(`   📝 ${text.trim()}`);
          }
        });
        
        pythonProcess.stdout?.on('data', (data) => {
          const text = data.toString();
          stdoutOutput += text;
          // Show any stdout output immediately for progress
          if (text.trim()) {
            console.log(`   📝 ${text.trim()}`);
          }
        });
      }
      
      pythonProcess.on('close', (code) => {
        clearInterval(progressInterval);
        if (code === 0) {
          console.log(`✅ Wiki pipeline completed successfully`);
          resolve({ success: true });
        } else {
          console.error(`❌ Wiki pipeline failed with exit code ${code}`);
          if (errorOutput) {
            console.error(`   Error output: ${errorOutput}`);
          }
          if (stdoutOutput) {
            console.log(`   Standard output: ${stdoutOutput}`);
          }
          resolve({ success: false, error: errorOutput || `Exit code ${code}` });
        }
      });
      
      pythonProcess.on('error', (error) => {
        console.error(`❌ Wiki pipeline process error: ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * Convert pipeline output to our format and copy to output directory
   */
  private async convertPipelineOutput(): Promise<{ puzzleCount: number; metadata: any }> {
    const pipelinePath = path.resolve('../datascience/themes_quality/wiki_puzzle_pipeline');
    const puzzlesPath = path.join(pipelinePath, 'data/wiki_puzzles.json');
    const metadataPath = path.join(pipelinePath, 'data/puzzle_metadata.json');
    
    // Read the generated files
    const puzzlesData = await fs.readFile(puzzlesPath, 'utf-8');
    const metadataData = await fs.readFile(metadataPath, 'utf-8');
    
    const puzzles = JSON.parse(puzzlesData);
    const metadata = JSON.parse(metadataData);
    
    // Copy files to our output directory
    const outputPuzzlesPath = path.join(this.config.outputDir, 'puzzles.json');
    const outputMetadataPath = path.join(this.config.outputDir, 'metadata.json');
    
    await fs.writeFile(outputPuzzlesPath, puzzlesData);
    await fs.writeFile(outputMetadataPath, metadataData);
    
    // Create a summary file
    const summary = {
      algorithm: 'wiki_puzzle_pipeline',
      generatedAt: new Date().toISOString(),
      puzzleCount: puzzles.total_count || puzzles.puzzles?.length || 0,
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
      puzzleCount: summary.puzzleCount,
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
    const setName = `wiki_batch_${dateStamp}`;
    const firebaseOutputPath = path.join(this.config.outputDir, 'firebase-format.json');
    
    await converter.convertBatchToFirebase(
      this.config.outputDir,
      'wiki_puzzle_pipeline',
      firebaseOutputPath,
      setName
    );
    
    console.log(`💾 Firebase format saved to: ${firebaseOutputPath}`);
    console.log(`🏷️  Set name: ${setName}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outputDir = args[0] || './batch-output/set1-wiki-pipeline';
  const verbose = args.includes('--verbose');
  
  console.log(`🎯 Wiki Batch Generator`);
  console.log(`📁 Output: ${outputDir}`);
  console.log(`🔍 Verbose: ${verbose}`);
  
  const generator = new WikiBatchGenerator({ outputDir, verbose });
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

export { WikiBatchGenerator };