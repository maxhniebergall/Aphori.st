#!/usr/bin/env node

/**
 * Test Named Sets Format
 * Verify that the new Firebase format uses named sets correctly
 */

import fs from 'fs/promises';
import path from 'path';
import { FirebaseFormatConverter, FirebaseOutput } from './firebase-format-converter.js';

async function testNamedSetsFormat() {
  console.log(`🧪 Testing Named Sets Format...`);
  
  try {
    // Create mock puzzle data for testing
    const mockPuzzleData = {
      puzzles: [
        {
          id: 1,
          theme: "Test Theme",
          words: ["word1", "word2", "word3", "word4"],
          similarity_scores: [0.8, 0.7, 0.9, 0.6]
        }
      ],
      total_count: 1
    };
    
    // Create temporary test directory and file
    const testDir = './test-named-sets';
    await fs.mkdir(testDir, { recursive: true });
    const puzzlesPath = path.join(testDir, 'puzzles.json');
    await fs.writeFile(puzzlesPath, JSON.stringify(mockPuzzleData, null, 2));
    
    console.log(`📝 Created test data: ${puzzlesPath}`);
    
    // Test Firebase conversion with custom set name
    const converter = new FirebaseFormatConverter();
    const customSetName = 'test_set_2025';
    const outputPath = path.join(testDir, 'firebase-output.json');
    
    const result = await converter.convertBatchToFirebase(
      testDir,
      'wiki_puzzle_pipeline',
      outputPath,
      customSetName
    );
    
    // Verify the structure
    console.log(`🔍 Verifying named sets structure...`);
    
    // Check puzzleSets structure
    if (!result.puzzleSets) {
      throw new Error('Missing puzzleSets in output');
    }
    
    if (!result.puzzleSets[customSetName]) {
      throw new Error(`Missing set "${customSetName}" in puzzleSets`);
    }
    
    if (!result.puzzleSets[customSetName]['4x4']) {
      throw new Error(`Missing 4x4 grid in set "${customSetName}"`);
    }
    
    // Check setIndex structure
    if (!result.setIndex) {
      throw new Error('Missing setIndex in output');
    }
    
    if (!result.setIndex[customSetName]) {
      throw new Error(`Missing set "${customSetName}" in setIndex`);
    }
    
    const setInfo = result.setIndex[customSetName];
    if (setInfo.algorithm !== 'wiki_puzzle_pipeline') {
      throw new Error(`Incorrect algorithm in setIndex: ${setInfo.algorithm}`);
    }
    
    if (!setInfo.metadata || !setInfo.metadata.batchGenerated) {
      throw new Error('Missing batch generation metadata');
    }
    
    // Check puzzle structure
    const puzzles = Object.values(result.puzzleSets[customSetName]['4x4']);
    if (puzzles.length === 0) {
      throw new Error('No puzzles found in set');
    }
    
    const firstPuzzle = puzzles[0] as any;
    if (firstPuzzle.setName !== customSetName) {
      throw new Error(`Puzzle setName mismatch: expected "${customSetName}", got "${firstPuzzle.setName}"`);
    }
    
    console.log(`✅ Named sets format validation passed!`);
    console.log(`📊 Test results:`);
    console.log(`   - Set name: ${customSetName}`);
    console.log(`   - Puzzles in set: ${puzzles.length}`);
    console.log(`   - Algorithm: ${setInfo.algorithm}`);
    console.log(`   - Total count: ${setInfo.totalCount}`);
    console.log(`   - Status: ${setInfo.status}`);
    
    // Read and display a sample of the output
    const outputData = await fs.readFile(outputPath, 'utf-8');
    const parsed = JSON.parse(outputData);
    
    console.log(`\n📄 Sample output structure:`);
    console.log(`   puzzleSets keys: [${Object.keys(parsed.puzzleSets).join(', ')}]`);
    console.log(`   setIndex keys: [${Object.keys(parsed.setIndex).join(', ')}]`);
    
    // Clean up test files
    await fs.rm(testDir, { recursive: true });
    console.log(`🧹 Cleaned up test directory`);
    
    console.log(`\n🎉 Named sets format test completed successfully!`);
    
  } catch (error) {
    console.error(`❌ Named sets format test failed: ${error}`);
    // Try to clean up even on failure
    try {
      await fs.rm('./test-named-sets', { recursive: true });
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testNamedSetsFormat().catch(console.error);
}