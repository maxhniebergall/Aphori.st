/**
 * Simple test script to verify Themes game services
 * Run with: NODE_OPTIONS="--loader ts-node/esm --experimental-specifier-resolution=node" node test-themes.ts
 */

import { createDatabaseClient } from './db/index.js';
import { MockEmbeddingProvider } from './services/mockEmbeddingProvider.js';
import { ThemesVectorService } from './services/games/ThemesVectorService.js';
import { ThemesWordDataset } from './services/games/ThemesWordDataset.js';
import { ThemesPuzzleGenerator } from './services/games/ThemesPuzzleGenerator.js';
import logger from './logger.js';

async function testThemesServices() {
  try {
    logger.info('Starting Themes services test...');

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

    // Test 2: Initialize word dataset (small test)
    logger.info('Test 2: Testing word dataset...');
    const testWords = ['cat', 'dog', 'bird', 'fish', 'apple', 'banana', 'car', 'bus'];
    const result = await wordDataset.addWordsToDataset(testWords);
    logger.info('Word dataset result:', result);

    const datasetStats = await wordDataset.getDatasetStats();
    logger.info('Dataset stats:', datasetStats);

    // Test 3: Test vector similarity
    logger.info('Test 3: Testing vector similarity...');
    const similarWords = await vectorService.findSimilarWords('cat', 3);
    logger.info('Similar words to "cat":', similarWords);

    // Test 4: Generate a simple puzzle
    logger.info('Test 4: Testing puzzle generation...');
    const puzzle = await puzzleGenerator.generatePuzzle({
      date: '2024-01-01',
      puzzleNumber: 1,
      gridSize: 4
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