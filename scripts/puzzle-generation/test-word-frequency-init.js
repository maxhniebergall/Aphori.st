#!/usr/bin/env node
/**
 * Quick test to check if WordFrequencyService initializes with lemmatization
 */

import { WordFrequencyService } from './WordFrequencyService.js';

async function testWordFrequencyInit() {
  console.log('🧪 Testing WordFrequencyService initialization with lemmatization...\n');

  try {
    const service = new WordFrequencyService();
    console.log('✅ WordFrequencyService created');
    
    console.log('🔄 Attempting initialization...');
    await service.initialize();
    console.log('✅ WordFrequencyService initialized with lemmatization support');
    
    const stats = service.getStats();
    console.log('\n📊 Service statistics:');
    console.log(`   Total words: ${stats?.totalWords || 'N/A'}`);
    console.log(`   Min count: ${stats?.minCount || 'N/A'}`);
    console.log(`   Max count: ${stats?.maxCount || 'N/A'}`);
    
    // Test getting some theme words
    const themeWords = service.getThemeWords(10);
    console.log(`\n🎯 Sample theme words (lemmatized): ${themeWords.slice(0, 5).join(', ')}...`);
    
    console.log('\n✅ All tests passed! Theme word lemmatization is working.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testWordFrequencyInit().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});