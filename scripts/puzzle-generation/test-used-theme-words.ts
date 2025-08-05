/**
 * Test script for UsedThemeWords functionality
 */

import { UsedThemeWords } from './UsedThemeWords.js';

async function testUsedThemeWords() {
  console.log('🧪 Testing UsedThemeWords functionality...\n');

  const tracker = new UsedThemeWords();

  // Test initial state
  console.log('📊 Initial stats:', tracker.getStats());
  
  // Test word checking and marking
  const testWords = ['example', 'test', 'sample', 'demo', 'prototype'];
  
  console.log('\n📝 Testing word usage tracking:');
  for (const word of testWords) {
    console.log(`   "${word}" used before: ${tracker.isWordUsed(word)}`);
    tracker.markWordAsUsed(word, `puzzle-${Date.now()}`, 'test-session');
    console.log(`   "${word}" used after marking: ${tracker.isWordUsed(word)}`);
  }

  // Test stats after adding words
  console.log('\n📊 Final stats:', tracker.getStats());
  
  // Test duplicate marking (should not create duplicates)
  console.log('\n🔁 Testing duplicate marking:');
  const beforeDuplicate = tracker.getStats().totalUsed;
  tracker.markWordAsUsed('example', 'another-puzzle');
  const afterDuplicate = tracker.getStats().totalUsed;
  console.log(`   Total before: ${beforeDuplicate}, after: ${afterDuplicate} (should be same)`);

  // Show all used words
  console.log('\n📋 All used theme words:');
  const allUsed = tracker.getAllUsedWords();
  allUsed.forEach(entry => {
    console.log(`   - ${entry.word} (first used: ${entry.firstUsed})`);
  });

  console.log('\n✅ UsedThemeWords test completed!');
}

// Run the test
testUsedThemeWords().catch(console.error);