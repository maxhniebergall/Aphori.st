#!/usr/bin/env node

/**
 * Test Quality Controls
 * Verify that quality-controlled word selection is working correctly
 */

import { FullVectorLoader } from './FullVectorLoader.js';

async function testQualityControls() {
  console.log('🧪 Testing Quality Controls...\n');
  
  try {
    // Initialize vector loader
    console.log('🔄 Initializing FullVectorLoader...');
    const vectorLoader = new FullVectorLoader();
    const loadResult = await vectorLoader.initialize();
    
    if (!loadResult.success) {
      throw new Error('Failed to load vector index');
    }
    
    console.log(`✅ Loaded ${loadResult.loadedWords}/${loadResult.totalWords} words\n`);

    // Test with various theme words to see quality controls in action
    const testThemes = [
      { word: 'cat', expected: 'should filter out "cats" and other cat-containing words' },
      { word: 'house', expected: 'should filter out "houses" and similar containing words' },
      { word: 'run', expected: 'should filter out "running", "runs", etc.' },
      { word: 'book', expected: 'should filter out "books", "bookmark", etc.' },
      { word: 'play', expected: 'should filter out "playing", "player", etc.' }
    ];
    
    for (const testTheme of testThemes) {
      console.log(`🎯 Testing theme: "${testTheme.word}"`);
      console.log(`   Expected: ${testTheme.expected}\n`);
      
      try {
        // Test original method (no quality controls)
        console.log('   📊 Original findNearest (no quality controls):');
        const originalResults = await vectorLoader.findNearest(testTheme.word, 8);
        originalResults.slice(0, 5).forEach((result, idx) => {
          console.log(`      ${idx + 1}. ${result.word} (similarity: ${result.similarity.toFixed(3)})`);
        });
        
        console.log('\n   🔒 With Quality Controls:');
        // Test quality-controlled method
        const qualityResults = await vectorLoader.findNearestWithQualityControls(testTheme.word, 5);
        
        if (qualityResults.length > 0) {
          console.log(`   ✅ Found ${qualityResults.length} quality-controlled words:`);
          qualityResults.forEach((result, idx) => {
            console.log(`      ${idx + 1}. ${result.word} (similarity: ${result.similarity.toFixed(3)})`);
          });
          
          // Check if any of the quality results contain the theme word
          const containsTheme = qualityResults.some(r => 
            r.word.toLowerCase().includes(testTheme.word.toLowerCase()) || 
            testTheme.word.toLowerCase().includes(r.word.toLowerCase())
          );
          
          if (containsTheme) {
            console.log(`   ⚠️ Warning: Some results contain theme word "${testTheme.word}"`);
          } else {
            console.log(`   ✅ No results contain theme word "${testTheme.word}"`);
          }
          
        } else {
          console.log('   ❌ No quality-controlled words found');
        }
        
      } catch (error) {
        console.log(`   ❌ Error: ${(error as Error).message}`);
      }
      
      console.log('\n' + '─'.repeat(60) + '\n');
    }
    
    console.log('🎉 Quality controls test completed!');
    
  } catch (error) {
    console.error('💥 Test failed:', (error as Error).message);
    process.exit(1);
  }
}

// Run test if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  testQualityControls().catch(console.error);
}

export { testQualityControls };