#!/usr/bin/env node

/**
 * Use Gemini Output - Recommended Approach
 * Uses the proven data science pipeline output for high-quality puzzles
 */

import fs from 'fs/promises';
import path from 'path';
import { DataScienceBridge } from './data-science-bridge.js';

async function main() {
  console.log('🎯 Recommended Approach: Using Proven Gemini Output\n');
  
  const geminiOutputPath = '../datascience/themes_quality/wiki_puzzle_gemini_pipeline/data/outputs/final_puzzles.json';
  const outputPath = './gemini-puzzles.json';
  const targetDate = new Date().toISOString().split('T')[0];
  
  console.log('📊 Quality Comparison:');
  console.log('   ✅ Data Science Pipeline: Coherent themes (Space, Sailing, Clothing)');
  console.log('   ❌ Local Vector Search: Random words (keen, beck, lecher, kinsman)');
  console.log('');
  
  try {
    // Check if Gemini output exists
    await fs.access(geminiOutputPath);
    console.log(`✅ Found Gemini output: ${geminiOutputPath}`);
    
    // Convert to puzzle format
    const bridge = new DataScienceBridge();
    const result = await bridge.convertDataScienceOutput(geminiOutputPath, outputPath, targetDate);
    
    console.log('\n🎉 Success! High-quality puzzles generated:');
    console.log(`📁 Output: ${outputPath}`);
    console.log(`📁 Firebase: ${outputPath.replace('.json', '_firebase.json')}`);
    console.log(`🎲 Puzzles: ${result.puzzles.length}`);
    console.log(`⭐ Avg Quality: ${(result.puzzles.reduce((sum, p) => sum + p.metadata.qualityScore, 0) / result.puzzles.length).toFixed(3)}`);
    
    // Show example themes
    console.log('\n📋 Example Themes Generated:');
    result.puzzles.slice(0, 2).forEach((puzzle, idx) => {
      console.log(`   ${idx + 1}. ${puzzle.gridSize}x${puzzle.gridSize} Puzzle:`);
      puzzle.categories.forEach(cat => {
        console.log(`      • ${cat.themeWord}: [${cat.words.join(', ')}]`);
      });
    });
    
    console.log('\n💡 Recommendation:');
    console.log('   Use this Gemini-generated output for production puzzles');
    console.log('   Quality is significantly higher than local vector similarity');
    
  } catch (error) {
    console.error(`❌ Error: ${(error as Error).message}`);
    console.log('\n💡 Alternative: Run the data science pipeline first:');
    console.log('   cd ../datascience/themes_quality/wiki_puzzle_gemini_pipeline');
    console.log('   python pipeline/gemini_enhancer.py');
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };