import { MockEmbeddingProvider } from '../mockEmbeddingProvider.js';
import { jest } from '@jest/globals';
import logger from '../../logger.js';

// Create function spies for logger methods
const mockLoggerInfo = jest.spyOn(logger, 'info').mockImplementation(() => {});
const mockLoggerWarn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
const mockLoggerError = jest.spyOn(logger, 'error').mockImplementation(() => {});
const mockLoggerDebug = jest.spyOn(logger, 'debug').mockImplementation(() => {});

const MOCK_EMBEDDING_DIMENSION_FROM_PROVIDER = 768; // As defined in MockEmbeddingProvider

describe('MockEmbeddingProvider', () => {
  let provider: MockEmbeddingProvider;

  beforeEach(() => {
    provider = new MockEmbeddingProvider();
    // Clear logger mocks
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
    mockLoggerDebug.mockClear();
  });

  it('constructor should log initialization', () => {
    // Constructor is called in beforeEach, so logger.info would have been called.
    // To specifically test the constructor log without interference from beforeEach,
    // we can clear mocks then instantiate.
    mockLoggerInfo.mockClear();
    new MockEmbeddingProvider(); 
    expect(mockLoggerInfo).toHaveBeenCalledWith("MockEmbeddingProvider initialized. Will return dummy embeddings.");
  });

  describe('generateEmbedding', () => {
    it('should return a dummy vector of the correct dimension', async () => {
      const text = 'test input string';
      const embedding = await provider.generateEmbedding(text);

      expect(embedding).toBeInstanceOf(Array);
      expect(embedding).toHaveLength(MOCK_EMBEDDING_DIMENSION_FROM_PROVIDER);
      // Check if it contains numbers (e.g., the dummy values (i + 1) * 0.001)
      if (embedding) {
        expect(embedding[0]).toBe(0.001);
        expect(embedding[MOCK_EMBEDDING_DIMENSION_FROM_PROVIDER - 1]).toBe(MOCK_EMBEDDING_DIMENSION_FROM_PROVIDER * 0.001);
        embedding.forEach((val: number) => expect(typeof val).toBe('number'));
      }
      expect(mockLoggerDebug).toHaveBeenCalledWith(`MockEmbeddingProvider: "Generating" embedding for: "${text.substring(0, 30)}..."`);
    });

    // generateEmbedding in MockEmbeddingProvider is quite simple and doesn't have specific error conditions to test beyond returning the dummy vector.
  });

  describe('getDimension', () => {
    it('should return the predefined MOCK_EMBEDDING_DIMENSION', () => {
      expect(provider.getDimension()).toBe(MOCK_EMBEDDING_DIMENSION_FROM_PROVIDER);
    });
  });
}); 