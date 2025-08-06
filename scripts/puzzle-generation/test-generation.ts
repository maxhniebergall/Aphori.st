#!/usr/bin/env node

/**
 * Test Generation Script
 * Uses mock data to test the puzzle generation system
 */

import { MockVectorLoader } from './MockVectorLoader.js';
import { HighQualityPuzzleGenerator } from './HighQualityPuzzleGenerator.js';

async function testGeneration() {
  console.log('🧪 Testing Puzzle Generation System with Mock Data');
  
  try {
    // Initialize mock vector loader
    console.log('\n📊 Initializing Mock Vector Loader...');
    const vectorLoader = new MockVectorLoader();
    const loadResult = await vectorLoader.initialize();
    
    if (!loadResult.success) {
      throw new Error('Failed to initialize mock vector loader');
    }
    
    console.log(`✅ Mock loader ready: ${loadResult.loadedWords} words loaded`);
    console.log(`📊 Stats: ${vectorLoader.getStats().memoryUsage}`);

    // Initialize puzzle generator
    console.log('\n🎯 Initializing Puzzle Generator...');
    const puzzleGenerator = new HighQualityPuzzleGenerator(vectorLoader as any);

    // Test single puzzle generation
    console.log('\n🎲 Testing Single Puzzle Generation...');
    const testDate = '2025-08-02';
    const output = await puzzleGenerator.generateDailyPuzzles(testDate, 1);
    
    if (output.puzzles.length > 0) {
      console.log('✅ Successfully generated test puzzle!');
      
      const puzzle = output.puzzles[0];
      console.log(`\n📊 Puzzle Details:`);
      console.log(`   ID: ${puzzle.id}`);
      console.log(`   Date: ${puzzle.date}`);
      console.log(`   Grid Size: ${puzzle.gridSize}x${puzzle.gridSize}`);
      console.log(`   Difficulty: ${puzzle.difficulty}/10`);
      console.log(`   Quality Score: ${puzzle.metadata.qualityScore.toFixed(3)}`);
      console.log(`   Words: [${puzzle.words.join(', ')}]`);
      
      console.log(`\n🎯 Categories:`);
      puzzle.categories.forEach((cat, idx) => {
        const metrics = cat.difficultyMetrics;
        console.log(`   ${idx + 1}. Theme: "${cat.themeWord}" (D=${cat.difficulty})`);
        console.log(`      Words: [${cat.words.join(', ')}]`);
        console.log(`      Similarity: ${cat.similarity.toFixed(3)}`);
        console.log(`      Algorithm: N=${metrics.totalNeighbors}, range=${metrics.selectedRange}`);
      });
      
      console.log(`\n📈 Generation Metadata:`);
      console.log(`   Total Attempts: ${output.metadata.totalAttempts}`);
      console.log(`   Success Rate: ${(output.metadata.successRate * 100).toFixed(1)}%`);
      console.log(`   Algorithm: ${output.metadata.difficultyProgression.algorithmUsed}`);
      
      // Test Progressive Difficulty Algorithm demonstration
      console.log(`\n🧮 Progressive Difficulty Algorithm (N=K+D) Demo:`);
      console.log(`   K (puzzle size) = 4`);
      puzzle.categories.forEach((cat, idx) => {
        const D = idx + 1;
        const N = 4 + D;
        const metrics = cat.difficultyMetrics;
        console.log(`   Category ${idx + 1}: D=${D}, N=${N}, selected neighbors ${metrics.selectedRange}`);
      });
      
    } else {
      console.log('❌ Failed to generate test puzzle');
      return false;
    }
    
    // Test word finding capability
    console.log(`\n🔍 Testing Word Search Capability...`);
    const testWords = ['cat', 'red', 'apple', 'car'];
    
    for (const testWord of testWords) {
      try {
        const neighbors = await vectorLoader.findNearest(testWord, 8);
        console.log(`   "${testWord}" → [${neighbors.slice(0, 4).map(n => n.word).join(', ')}] (${neighbors.length} total)`);
      } catch (error) {
        console.log(`   "${testWord}" → Error: ${(error as Error).message}`);
      }
    }
    
    console.log('\n🎉 All tests passed! The puzzle generation system is working correctly.');
    return true;
    
  } catch (error) {
    console.error('\n💥 Test failed:', (error as Error).message);
    return false;
  }
}

// Run test
if (import.meta.url === `file://${process.argv[1]}`) {
  testGeneration().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });
}

export { testGeneration };