#!/usr/bin/env node
/**
 * Quick test of puzzle generation with real data
 */

import { HighQualityPuzzleGenerator } from './HighQualityPuzzleGenerator.js';
import { FullVectorLoader } from './FullVectorLoader.js';

async function quickGenerationTest() {
  console.log('🧪 Quick puzzle generation test...\n');

  try {
    console.log('🔧 Initializing full vector loader...');
    const vectorLoader = new FullVectorLoader();
    
    const startTime = Date.now();
    const loadResult = await vectorLoader.initialize();
    const initTime = Date.now() - startTime;
    
    if (!loadResult.success) {
      throw new Error('Failed to initialize vector loader');
    }
    
    console.log(`✅ Vector loader initialized in ${initTime}ms`);
    console.log(`📊 Loaded ${loadResult.loadedWords} words\n`);
    
    console.log('🎯 Creating puzzle generator...');
    const puzzleGenerator = new HighQualityPuzzleGenerator(vectorLoader);
    
    console.log('🎲 Generating a single 4x4 puzzle...');
    const genStartTime = Date.now();
    
    const result = await puzzleGenerator.generateDailyPuzzles('2025-08-07', 1);
    const genTime = Date.now() - genStartTime;
    
    console.log(`⏱️ Generation completed in ${genTime}ms`);
    console.log(`📊 Generated ${result.puzzles.length} puzzles`);
    
    if (result.puzzles.length > 0) {
      const puzzle = result.puzzles[0];
      console.log(`\n✅ Generated puzzle ${puzzle.id}:`);
      console.log(`   📏 Size: ${puzzle.gridSize}x${puzzle.gridSize}`);
      console.log(`   🏆 Quality: ${puzzle.metadata.qualityScore.toFixed(2)}`);
      console.log(`   🎯 Categories:`);
      
      puzzle.categories.forEach((cat, idx) => {
        console.log(`      ${idx + 1}. "${cat.themeWord}" → [${cat.words.join(', ')}] (${cat.similarity.toFixed(3)})`);
      });
      
      console.log(`\n🎲 Puzzle words: [${puzzle.words.join(', ')}]`);
    } else {
      console.log('❌ No puzzles generated');
    }
    
    console.log(`\n📈 Performance summary:`);
    console.log(`   Initialization: ${initTime}ms`);
    console.log(`   Generation: ${genTime}ms`);
    console.log(`   Total: ${initTime + genTime}ms`);
    
    if (initTime + genTime < 30000) {
      console.log(`   ✅ EXCELLENT: Under 30 seconds total`);
    } else if (initTime + genTime < 60000) {
      console.log(`   ✅ GOOD: Under 1 minute total`);
    } else {
      console.log(`   ⚠️ ACCEPTABLE: Over 1 minute but functional`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

quickGenerationTest().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});