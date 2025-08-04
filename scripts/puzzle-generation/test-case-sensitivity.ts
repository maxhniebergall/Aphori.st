#!/usr/bin/env node

/**
 * Test Case Sensitivity Fix
 * Verify that duplicate words with different cases are properly filtered out
 */

import { FullVectorLoader } from './FullVectorLoader.js';

async function testCaseSensitivity() {
  console.log('🧪 Testing Case Sensitivity Fix...\n');
  
  try {
    // Initialize vector loader
    console.log('🔄 Initializing FullVectorLoader...');
    const vectorLoader = new FullVectorLoader();
    const loadResult = await vectorLoader.initialize();
    
    if (!loadResult.success) {
      throw new Error('Failed to load vector index');
    }
    
    console.log(`✅ Loaded ${loadResult.loadedWords}/${loadResult.totalWords} words\n`);

    // Test case-sensitive duplicate detection
    console.log('🔤 Testing case-sensitive duplicate detection:\n');
    
    // Create existing words with mixed cases
    const existingWords = new Set(['your', 'HELLO', 'World', 'test']);
    
    console.log(`   Existing words: [${Array.from(existingWords).join(', ')}]\n`);
    
    // Test words that should be rejected due to case-insensitive duplicates
    const testCases = [
      { word: 'YOUR', existing: 'your', shouldReject: true },
      { word: 'hello', existing: 'HELLO', shouldReject: true },
      { word: 'WORLD', existing: 'World', shouldReject: true },
      { word: 'Test', existing: 'test', shouldReject: true },
      { word: 'different', existing: 'none', shouldReject: false },
      { word: 'unique', existing: 'none', shouldReject: false }
    ];
    
    for (const testCase of testCases) {
      console.log(`🎯 Testing "${testCase.word}" (should ${testCase.shouldReject ? 'reject' : 'accept'}):`);
      
      try {
        const results = await vectorLoader.findNearestWithQualityControls(testCase.word, 3, existingWords);
        
        if (testCase.shouldReject) {
          if (results.length === 0) {
            console.log(`   ✅ Correctly rejected "${testCase.word}" (case-insensitive duplicate of "${testCase.existing}")`);
          } else {
            console.log(`   ❌ Failed to reject "${testCase.word}" - found ${results.length} results`);
            results.forEach((result, idx) => {
              console.log(`      ${idx + 1}. ${result.word} (similarity: ${result.similarity.toFixed(3)})`);
            });
          }
        } else {
          if (results.length > 0) {
            console.log(`   ✅ Correctly accepted "${testCase.word}" - found ${results.length} results`);
            results.slice(0, 2).forEach((result, idx) => {
              console.log(`      ${idx + 1}. ${result.word} (similarity: ${result.similarity.toFixed(3)})`);
            });
          } else {
            console.log(`   ⚠️ No results found for "${testCase.word}" (may be due to other quality controls)`);
          }
        }
      } catch (error) {
        console.log(`   ❌ Error: ${(error as Error).message}`);
      }
      
      console.log(''); // Empty line for readability
    }
    
    console.log('🎉 Case sensitivity test completed!');
    
  } catch (error) {
    console.error('💥 Test failed:', (error as Error).message);
    process.exit(1);
  }
}

// Run test if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  testCaseSensitivity().catch(console.error);
}

export { testCaseSensitivity };