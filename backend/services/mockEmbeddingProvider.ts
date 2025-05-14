import { EmbeddingProvider } from './embeddingProvider';
import logger from '../logger.js'; // Assuming logger is in a similar path

const MOCK_EMBEDDING_DIMENSION = 768; // Match the expected dimension of your real model

export class MockEmbeddingProvider implements EmbeddingProvider {
  constructor() {
    logger.info("MockEmbeddingProvider initialized. Will return dummy embeddings.");
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    // Simple dummy vector: an array of zeros or small numbers.
    // Ensure it matches the expected dimension.
    const dummyVector = new Array(MOCK_EMBEDDING_DIMENSION).fill(0).map((_, i) => (i + 1) * 0.001);

    // You could log the text to simulate processing
    logger.debug(`MockEmbeddingProvider: "Generating" embedding for: "${text.substring(0, 30)}..."`);

    // Simulate a small delay if helpful
    // await new Promise(resolve => setTimeout(resolve, 50));

    return Promise.resolve(dummyVector);
  }

  getDimension(): number {
    return MOCK_EMBEDDING_DIMENSION;
  }
} 