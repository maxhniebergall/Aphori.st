#!/usr/bin/env node

/**
 * Test Spell Check Service
 * Verify that spell-checking based quality controls are working correctly
 */

import { SpellCheckService } from './SpellCheckService.js';

async function testSpellCheck() {
  console.log('🧪 Testing Spell Check Service...\n');
  
  try {
    // Initialize spell check service
    console.log('🔄 Initializing SpellCheckService...');
    const spellCheckService = new SpellCheckService();
    await spellCheckService.initialize();
    
    console.log('✅ SpellCheckService initialized\n');

    // Test cases for spell checking
    const testCases = [
      // Basic spelling checks
      { word: 'cat', expected: true, description: 'correctly spelled word' },
      { word: 'cats', expected: true, description: 'plural form' },
      { word: 'runing', expected: false, description: 'misspelled word (should be "running")' },
      { word: 'running', expected: true, description: 'correctly spelled word' },
      
    ];

    const sameSepellingTestCases = [
      // Same spelling checks
      { word1: 'cat', word2: 'cats', expectedSame: false, description: 'different correct spellings' },
      { word1: 'runing', word2: 'running', expectedSame: true, description: 'same correct spelling (misspelled vs correct)' },
      { word1: 'color', word2: 'colour', expectedSame: false, description: 'different spellings both correct' },
      { word1: 'house', word2: 'houses', expectedSame: false, description: 'singular vs plural' },
    ];

    const canonicalFormTestCases = [
      // Canonical form checks (base word forms)
      { word1: 'cat', word2: 'cats', expectedSame: true, description: 'singular vs plural should have same base' },
      { word1: 'run', word2: 'running', expectedSame: true, description: 'verb base vs gerund' },
      { word1: 'run', word2: 'runs', expectedSame: true, description: 'verb base vs third person singular' },
      { word1: 'run', word2: 'ran', expectedSame: true, description: 'verb base vs past tense' },
      { word1: 'house', word2: 'houses', expectedSame: true, description: 'noun base vs plural' },
      { word1: 'big', word2: 'bigger', expectedSame: true, description: 'adjective base vs comparative' },
      { word1: 'big', word2: 'biggest', expectedSame: true, description: 'adjective base vs superlative' },
      { word1: 'quick', word2: 'quickly', expectedSame: false, description: 'adjective vs adverb (different forms)' },
      { word1: 'cat', word2: 'dog', expectedSame: false, description: 'completely different words' },
      { word1: 'runing', word2: 'runs', expectedSame: true, description: 'misspelled form vs correct inflection' },
    ];

    console.log('🔍 Testing individual word spelling:');
    for (const testCase of testCases) {
      const isCorrect = spellCheckService.isCorrect(testCase.word);
      const result = isCorrect === testCase.expected ? '✅' : '❌';
      console.log(`   ${result} "${testCase.word}" - ${testCase.description} (expected: ${testCase.expected}, got: ${isCorrect})`);
      
      if (!isCorrect) {
        const suggestions = spellCheckService.getSuggestions(testCase.word);
        console.log(`      Suggestions: [${suggestions.slice(0, 3).join(', ')}]`);
      }
    }

    console.log('\n🔗 Testing same correct spelling detection:');
    for (const testCase of sameSepellingTestCases) {
      const haveSame = spellCheckService.haveSameCorrectSpelling(testCase.word1, testCase.word2);
      const result = haveSame === testCase.expectedSame ? '✅' : '❌';
      console.log(`   ${result} "${testCase.word1}" vs "${testCase.word2}" - ${testCase.description} (expected: ${testCase.expectedSame}, got: ${haveSame})`);
      
      const correct1 = spellCheckService.getCorrectSpelling(testCase.word1);
      const correct2 = spellCheckService.getCorrectSpelling(testCase.word2);
      console.log(`      Correct spellings: "${correct1}" vs "${correct2}"`);
    }

    console.log('\n🏗️ Testing canonical form detection (base words):');
    for (const testCase of canonicalFormTestCases) {
      const haveSame = spellCheckService.haveSameCanonicalForm(testCase.word1, testCase.word2);
      const result = haveSame === testCase.expectedSame ? '✅' : '❌';
      console.log(`   ${result} "${testCase.word1}" vs "${testCase.word2}" - ${testCase.description} (expected: ${testCase.expectedSame}, got: ${haveSame})`);
      
      const canonical1 = spellCheckService.getCanonicalForm(testCase.word1);
      const canonical2 = spellCheckService.getCanonicalForm(testCase.word2);
      console.log(`      Canonical forms: "${canonical1}" vs "${canonical2}"`);
    }

    console.log('\n🎯 Testing word set matching (spell check):');
    const wordSet = new Set(['cat', 'dog', 'running', 'house']);
    const setTestCases = [
      { word: 'cats', shouldMatch: false, description: 'plural vs singular' },
      { word: 'runing', shouldMatch: true, matchWith: 'running', description: 'misspelled version of existing word' },
      { word: 'bird', shouldMatch: false, description: 'completely different word' },
      { word: 'houses', shouldMatch: false, description: 'plural of existing word' },
    ];

    for (const testCase of setTestCases) {
      const matchResult = spellCheckService.hasMatchingCorrectSpelling(testCase.word, wordSet);
      const expectedMatch = testCase.shouldMatch;
      const result = matchResult.hasMatch === expectedMatch ? '✅' : '❌';
      
      console.log(`   ${result} "${testCase.word}" - ${testCase.description} (expected match: ${expectedMatch}, got: ${matchResult.hasMatch})`);
      
      if (matchResult.hasMatch) {
        console.log(`      Matches with: "${matchResult.matchingWord}" (correct spelling: "${matchResult.correctSpelling}")`);
      }
    }

    console.log('\n🏗️ Testing canonical form set matching:');
    const canonicalSetTestCases = [
      { word: 'cats', shouldMatch: true, matchWith: 'cat', description: 'plural should match singular base' },
      { word: 'runs', shouldMatch: true, matchWith: 'running', description: 'verb form should match existing verb form (same base)' },
      { word: 'houses', shouldMatch: true, matchWith: 'house', description: 'plural should match singular base' },
      { word: 'runing', shouldMatch: true, matchWith: 'running', description: 'misspelled should match corrected base form' },
      { word: 'bird', shouldMatch: false, description: 'completely different word' },
      { word: 'quickly', shouldMatch: false, description: 'adverb form of non-existing adjective' },
    ];

    for (const testCase of canonicalSetTestCases) {
      const matchResult = spellCheckService.hasMatchingCanonicalForm(testCase.word, wordSet);
      const expectedMatch = testCase.shouldMatch;
      const result = matchResult.hasMatch === expectedMatch ? '✅' : '❌';
      
      console.log(`   ${result} "${testCase.word}" - ${testCase.description} (expected match: ${expectedMatch}, got: ${matchResult.hasMatch})`);
      
      if (matchResult.hasMatch) {
        console.log(`      Matches with: "${matchResult.matchingWord}" (canonical form: "${matchResult.canonicalForm}")`);
      }
    }

    console.log('\n🎉 Enhanced spell check and lemmatization testing completed!');
    
  } catch (error) {
    console.error('💥 Test failed:', (error as Error).message);
    console.error('Stack trace:', (error as Error).stack);
    process.exit(1);
  }
}

// Run test if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  testSpellCheck().catch(console.error);
}

export { testSpellCheck };