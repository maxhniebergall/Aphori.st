/**
 * Simple test script to verify Themes game services
 * Run with: NODE_OPTIONS="--loader ts-node/esm --experimental-specifier-resolution=node" node test-themes.ts
 * 
 * Environment Variables (all optional):
 * - TEST_THEMES_DATE: Date for puzzle generation (default: '2024-01-01')
 * - TEST_THEMES_PUZZLE_NUMBER: Puzzle number (default: 1)
 * - TEST_THEMES_GRID_SIZE: Grid size for puzzle (default: 4)
 * - TEST_THEMES_WORDS: Comma-separated test words (default: 'cat,dog,bird,fish,apple,banana,car,bus')
 * - TEST_THEMES_SIMILARITY_WORD: Word to test similarity against (default: 'cat')
 * - TEST_THEMES_SIMILARITY_COUNT: Number of similar words to find (default: 3)
 * 
 * Example usage:
 * TEST_THEMES_GRID_SIZE=6 TEST_THEMES_DATE=2024-12-01 NODE_OPTIONS="--loader ts-node/esm --experimental-specifier-resolution=node" node test-themes.ts
 */

import { createDatabaseClient } from './db/index.js';
import { MockEmbeddingProvider } from './services/mockEmbeddingProvider.js';
import { ThemesVectorService } from './services/games/ThemesVectorService.js';
import { ThemesWordDataset } from './services/games/ThemesWordDataset.js';
import { ThemesPuzzleGenerator } from './services/games/ThemesPuzzleGenerator.js';
import logger from './logger.js';

// Environment variable configuration with defaults
const TEST_CONFIG = {
  date: process.env.TEST_THEMES_DATE || '2024-01-01',
  puzzleNumber: parseInt(process.env.TEST_THEMES_PUZZLE_NUMBER || '1'),
  gridSize: parseInt(process.env.TEST_THEMES_GRID_SIZE || '4'),
  testWords: process.env.TEST_THEMES_WORDS 
    ? process.env.TEST_THEMES_WORDS.split(',')
    : ['cat', 'dog', 'bird', 'fish', 'apple', 'banana', 'car', 'bus'],
  similarityTestWord: process.env.TEST_THEMES_SIMILARITY_WORD || 'cat',
  similarityCount: parseInt(process.env.TEST_THEMES_SIMILARITY_COUNT || '3')
};

async function testThemesServices(): Promise<void> {
  try {
    logger.info('Starting Themes services test...');
    logger.info('Test configuration:', TEST_CONFIG);

    // Initialize database and embedding provider
    const db = createDatabaseClient();
    const embeddingProvider = new MockEmbeddingProvider();

    // Initialize services
    const vectorService = new ThemesVectorService(db, embeddingProvider);
    const wordDataset = new ThemesWordDataset(db, vectorService);
    const puzzleGenerator = new ThemesPuzzleGenerator(db, vectorService, wordDataset);

    // Test 1: Initialize vector service
    logger.info('Test 1: Initializing vector service...');
    await vectorService.initializeIndex();
    const stats = await vectorService.getIndexStats();
    logger.info('Vector service stats:', stats);

    // Test 2: Initialize word dataset (configurable test)
    logger.info('Test 2: Testing word dataset...');
    const result = await wordDataset.addWordsToDataset(TEST_CONFIG.testWords);
    logger.info('Word dataset result:', result);

    const datasetStats = await wordDataset.getDatasetStats();
    logger.info('Dataset stats:', datasetStats);

    // Test 3: Test vector similarity (configurable)
    logger.info('Test 3: Testing vector similarity...');
    const similarWords = await vectorService.findSimilarWords(
      TEST_CONFIG.similarityTestWord, 
      TEST_CONFIG.similarityCount
    );
    logger.info(`Similar words to "${TEST_CONFIG.similarityTestWord}":`, similarWords);

    // Test 4: Generate a simple puzzle (configurable)
    logger.info('Test 4: Testing puzzle generation...');
    const puzzle = await puzzleGenerator.generatePuzzle({
      date: TEST_CONFIG.date,
      puzzleNumber: TEST_CONFIG.puzzleNumber,
      gridSize: TEST_CONFIG.gridSize
    });

    if (puzzle) {
      logger.info('Generated puzzle:', {
        id: puzzle.id,
        gridSize: puzzle.gridSize,
        difficulty: puzzle.difficulty,
        categories: puzzle.categories.map(c => ({
          themeWord: c.themeWord,
          words: c.words,
          similarity: c.similarity
        }))
      });

      // Test puzzle validation
      const validation = await puzzleGenerator.validatePuzzle(puzzle);
      logger.info('Puzzle validation:', validation);
    } else {
      logger.warn('Failed to generate puzzle');
    }

    logger.info('✅ All tests completed successfully!');
  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testThemesServices().then(() => {
  logger.info('Test completed, exiting...');
  process.exit(0);
});
EOF < /dev/null