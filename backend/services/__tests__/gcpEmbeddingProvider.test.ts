import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import logger from '../../logger.js';
import { GCPEmbeddingProvider } from '../gcpEmbeddingProvider.js';
import { MAX_POST_LENGTH } from '../../routes/posts.js';

// Create function spies for logger methods
jest.spyOn(logger, 'info').mockImplementation(() => {});
jest.spyOn(logger, 'warn').mockImplementation(() => {});
jest.spyOn(logger, 'error').mockImplementation(() => {});
jest.spyOn(logger, 'debug').mockImplementation(() => {});

// Mock the GoogleGenerativeAI module
jest.mock('@google/genai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      models: {
        embedContent: jest.fn()
      }
    }))
  };
});

const TEST_MODEL_ID = 'embedding-001';
const EXPECTED_DIMENSION = 768;
const TEST_API_KEY = 'test-gemini-api-key';

let originalApiKey: string | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  originalApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = TEST_API_KEY;
});

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalApiKey;
  }
});

describe('GCPEmbeddingProvider', () => {
  describe('constructor', () => {
    it('should create a new instance', () => {
      const provider = new GCPEmbeddingProvider(TEST_MODEL_ID, EXPECTED_DIMENSION);
      expect(provider).toBeInstanceOf(GCPEmbeddingProvider);
    });

    it('should throw an error if GEMINI_API_KEY is missing', () => {
      delete process.env.GEMINI_API_KEY;
      expect(() => new GCPEmbeddingProvider(TEST_MODEL_ID, EXPECTED_DIMENSION))
        .toThrow('GEMINI_API_KEY environment variable not set.');
    });
  });

  describe('getDimension', () => {
    it('should return the dimension provided in constructor', () => {
      const provider = new GCPEmbeddingProvider(TEST_MODEL_ID, EXPECTED_DIMENSION);
      expect(provider.getDimension()).toBe(EXPECTED_DIMENSION);
    });
  });
});
