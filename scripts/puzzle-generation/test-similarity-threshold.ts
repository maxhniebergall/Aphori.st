/**
 * Test script to verify the new 0.62 similarity threshold enforcement
 */

import { HighQualityPuzzleGenerator } from './HighQualityPuzzleGenerator.js';
import { FullVectorLoader } from './FullVectorLoader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testSimilarityThreshold() {
  console.log('🧪 Testing similarity threshold enforcement...\n');
  
  try {
    // Initialize the vector loader
    const vectorLoader = new FullVectorLoader();
    
    console.log('📚 Loading vector data...');
    await vectorLoader.initialize();
    
    // Initialize puzzle generator
    const generator = new HighQualityPuzzleGenerator(vectorLoader);
    
    console.log('🎯 Testing category generation with similarity threshold 0.62...\n');
    
    // Try to generate a few categories to see the similarity enforcement in action
    const usedWords = new Set<string>();
    
    for (let i = 0; i < 3; i++) {
      console.log(`--- Test Category ${i + 1} ---`);
      
      // Use reflection to call the private method for testing
      const categoryMethod = (generator as any).generateCategory;
      const category = await categoryMethod.call(generator, usedWords, i, 4);
      
      if (category) {
        console.log(`✅ Generated category with similarity: ${category.similarity.toFixed(3)}`);
        console.log(`   Theme: "${category.themeWord}"`);
        console.log(`   Words: [${category.words.join(', ')}]`);
        console.log(`   Meets 0.62 threshold: ${category.similarity >= 0.62 ? '✅' : '❌'}\n`);
        
        // Add words to used set
        category.words.forEach((word: string) => usedWords.add(word));
      } else {
        console.log(`❌ Failed to generate category ${i + 1}\n`);
      }
    }
    
    console.log('🏁 Test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testSimilarityThreshold().catch(console.error);