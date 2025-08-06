#!/usr/bin/env node

/**
 * Test Vector Functionality
 * Verify that FAISS KNN search is working correctly
 */

import { FullVectorLoader } from './FullVectorLoader.js';

async function testVectorFunctionality() {
  console.log('🧪 Testing Vector Functionality...\n');
  
  try {
    // Initialize vector loader
    console.log('🔄 Initializing FullVectorLoader...');
    const vectorLoader = new FullVectorLoader();
    const loadResult = await vectorLoader.initialize();
    
    if (!loadResult.success) {
      throw new Error('Failed to load vector index');
    }
    
    console.log(`✅ Loaded ${loadResult.loadedWords}/${loadResult.totalWords} words`);
    console.log(`📊 Stats: ${vectorLoader.getStats().memoryUsage} memory usage\n`);

    // Test with a few common seed words
    const testWords = ['cat', 'dog', 'house', 'car', 'book'];
    
    for (const testWord of testWords) {
      console.log(`🔍 Testing similarity search for "${testWord}":`);
      
      try {
        const neighbors = await vectorLoader.findNearest(testWord, 5);
        
        if (neighbors.length > 0) {
          console.log('   ✅ Found neighbors:');
          neighbors.forEach((neighbor, idx) => {
            console.log(`      ${idx + 1}. ${neighbor.word} (similarity: ${neighbor.similarity.toFixed(4)})`);
          });
          
          // Verify similarities are in descending order
          for (let i = 1; i < neighbors.length; i++) {
            if (neighbors[i].similarity > neighbors[i-1].similarity) {
              console.log(`   ⚠️ Warning: Similarities not in descending order at position ${i}`);
            }
          }
          
          // Check if all similarities are reasonable (between 0 and 1)
          const invalidSimilarities = neighbors.filter(n => n.similarity < 0 || n.similarity > 1);
          if (invalidSimilarities.length > 0) {
            console.log(`   ⚠️ Warning: ${invalidSimilarities.length} invalid similarities found`);
          }
          
        } else {
          console.log('   ❌ No neighbors found');
        }
      } catch (error) {
        console.log(`   ❌ Error: ${(error as Error).message}`);
      }
      
      console.log(''); // Empty line for readability
    }
    
    console.log('🎉 Vector functionality test completed!');
    
  } catch (error) {
    console.error('💥 Test failed:', (error as Error).message);
    process.exit(1);
  }
}

// Run test if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  testVectorFunctionality().catch(console.error);
}

export { testVectorFunctionality };