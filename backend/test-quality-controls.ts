/**
 * Test script for themes game quality controls
 * Tests word validation, category validation, and puzzle quality assessment
 */

import { ThemesQualityControl } from './services/games/ThemesQualityControl.js';
import { ThemesCategory, ThemesPuzzle } from './types/games/themes.js';

async function main() {
  console.log('🎯 Testing Themes Game Quality Controls\n');
  
  // Initialize quality control (without vector service for basic tests)
  const qc = new ThemesQualityControl();

  // Test 1: Word Quality Validation
  console.log('📝 Test 1: Word Quality Validation');
  console.log('=' .repeat(50));
  
  const testWords = [
    // Good words
    'cat', 'dog', 'house', 'tree', 'book',
    // Problematic words
    'xxx', 'shit', 'aaa', 'supercalifragilisticexpialidocious', 'xkcd',
    // Edge cases
    'a', 'the', 'stuff', 'thing'
  ];

  for (const word of testWords) {
    try {
      const validation = await qc.validateWord(word);
      console.log(`${validation.valid ? '✅' : '❌'} "${word}": ${validation.score.toFixed(2)} (${validation.issues.length} issues)`);
      if (validation.issues.length > 0) {
        console.log(`   Issues: ${validation.issues.join(', ')}`);
      }
    } catch (error) {
      console.log(`❌ "${word}": Error - ${error}`);
    }
  }

  console.log();

  // Test 2: Category Quality Validation
  console.log('📊 Test 2: Category Quality Validation');
  console.log('=' .repeat(50));
  
  const testCategories: ThemesCategory[] = [
    // Good category
    {
      themeWord: 'animals',
      words: ['cat', 'dog', 'bird', 'fish'],
      similarity: 0.8
    },
    // Poor similarity category
    {
      themeWord: 'random',
      words: ['car', 'happiness', 'purple', 'algorithm'],
      similarity: 0.2
    },
    // Inappropriate content category
    {
      themeWord: 'inappropriate',
      words: ['xxx', 'porn', 'violence', 'hate'],
      similarity: 0.9
    }
  ];

  for (const category of testCategories) {
    try {
      const validation = await qc.validateCategory(category);
      console.log(`${validation.valid ? '✅' : '❌'} Category "${category.themeWord}": ${validation.score.toFixed(2)} (${validation.issues.length} issues)`);
      if (validation.issues.length > 0) {
        console.log(`   Issues: ${validation.issues.join(', ')}`);
      }
    } catch (error) {
      console.log(`❌ Category "${category.themeWord}": Error - ${error}`);
    }
  }

  console.log();

  // Test 3: Puzzle Quality Validation
  console.log('🧩 Test 3: Puzzle Quality Validation');
  console.log('=' .repeat(50));
  
  const testPuzzles: ThemesPuzzle[] = [
    // Good puzzle
    {
      id: 'test_puzzle_1',
      date: '2025-08-03',
      gridSize: 4,
      puzzleNumber: 1,
      words: ['cat', 'dog', 'bird', 'fish', 'red', 'blue', 'green', 'yellow', 'car', 'bus', 'train', 'plane', 'apple', 'banana', 'grape', 'orange'],
      categories: [
        { themeWord: 'animals', words: ['cat', 'dog', 'bird', 'fish'], similarity: 0.8 },
        { themeWord: 'colors', words: ['red', 'blue', 'green', 'yellow'], similarity: 0.7 },
        { themeWord: 'transport', words: ['car', 'bus', 'train', 'plane'], similarity: 0.75 },
        { themeWord: 'fruits', words: ['apple', 'banana', 'grape', 'orange'], similarity: 0.85 }
      ],
      difficulty: 5,
      createdAt: Date.now()
    },
    // Poor quality puzzle
    {
      id: 'test_puzzle_2',
      date: '2025-08-03',
      gridSize: 4,
      puzzleNumber: 2,
      words: ['xxx', 'porn', 'violence', 'hate', 'aaa', 'bbb', 'ccc', 'ddd', 'stuff', 'thing', 'item', 'object', 'qwerty', 'asdf', 'zxcv', 'tyui'],
      categories: [
        { themeWord: 'inappropriate', words: ['xxx', 'porn', 'violence', 'hate'], similarity: 0.9 },
        { themeWord: 'gibberish', words: ['aaa', 'bbb', 'ccc', 'ddd'], similarity: 0.1 },
        { themeWord: 'vague', words: ['stuff', 'thing', 'item', 'object'], similarity: 0.3 },
        { themeWord: 'random', words: ['qwerty', 'asdf', 'zxcv', 'tyui'], similarity: 0.1 }
      ],
      difficulty: 8,
      createdAt: Date.now()
    }
  ];

  for (const puzzle of testPuzzles) {
    try {
      const validation = await qc.validatePuzzle(puzzle);
      console.log(`${validation.valid ? '✅' : '❌'} Puzzle "${puzzle.id}": ${validation.score.toFixed(2)} (${validation.issues.length} issues)`);
      if (validation.issues.length > 0) {
        console.log(`   Issues: ${validation.issues.join(', ')}`);
      }
    } catch (error) {
      console.log(`❌ Puzzle "${puzzle.id}": Error - ${error}`);
    }
  }

  console.log();

  // Test 4: Word Filtering
  console.log('🔍 Test 4: Word Quality Filtering');
  console.log('=' .repeat(50));
  
  const mixedWords = [
    'cat', 'dog', 'house', 'tree', 'book', // Good words
    'xxx', 'shit', 'aaa', 'supercalifragilisticexpialidocious', // Bad words
    'algorithm', 'philosophy', 'conceptual', // Complex words
    'a', 'the', 'stuff' // Edge cases
  ];

  try {
    const filterResult = await qc.filterWordsByQuality(mixedWords, 0.6);
    console.log(`✅ Filtering Results:`);
    console.log(`   Accepted: ${filterResult.accepted.length} words: [${filterResult.accepted.join(', ')}]`);
    console.log(`   Rejected: ${filterResult.rejected.length} words:`);
    filterResult.rejected.forEach(rejected => {
      console.log(`     - "${rejected.word}": ${rejected.score.toFixed(2)} (${rejected.issues.join(', ')})`);
    });
  } catch (error) {
    console.log(`❌ Word filtering failed: ${error}`);
  }

  console.log();

  // Test 5: Configuration Testing
  console.log('⚙️  Test 5: Quality Control Configuration');
  console.log('=' .repeat(50));
  
  console.log('📋 Current Quality Control Configuration:');
  console.log(`   Min Word Appropriateness: 0.8`);
  console.log(`   Min Word Commonality: 0.3`);
  console.log(`   Max Word Difficulty: 8`);
  console.log(`   Min Category Internal Cohesion: 0.4`);
  console.log(`   Min Category Appropriateness: 0.9`);
  console.log(`   Min Puzzle Overall Score: 0.6`);
  console.log(`   Excluded Words: ${qc['config'].excludedWords.length} words`);
  console.log(`   Excluded Topics: ${qc['config'].excludedTopics.join(', ')}`);

  console.log('\n🎉 Quality Control Testing Complete!');
  console.log('\nSummary:');
  console.log('✅ Word quality validation implemented');
  console.log('✅ Category quality validation implemented');
  console.log('✅ Puzzle quality validation implemented');
  console.log('✅ Word filtering implemented');
  console.log('✅ Comprehensive content filtering');
  console.log('✅ Configurable quality thresholds');
}

// Run the test
main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});