import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { VectorService } from '../vectorService.js';
import { MockEmbeddingProvider } from '../mockEmbeddingProvider.js';
import { VectorIndexMetadata, VectorDataForFaiss } from '../../types/index.js';

// Mock faiss-node
jest.mock('faiss-node');

// Mock the LoggedDatabaseClient
const mockDatabaseClient = {
  getVectorIndexMetadata: jest.fn(),
  getAllVectorsFromShards: jest.fn(),
  addVectorToShardStore: jest.fn(),
} as any;

describe('VectorService', () => {
  let vectorService: VectorService;
  let mockEmbeddingProvider: MockEmbeddingProvider;
  let mockFaissIndex: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock FAISS index
    mockFaissIndex = {
      add: jest.fn(),
      search: jest.fn(),
      ntotal: 0,
    };
    
    // Mock faiss module
    const faiss = require('faiss-node');
    faiss.IndexFlatL2 = jest.fn().mockImplementation(() => mockFaissIndex);
    
    // Create services
    mockEmbeddingProvider = new MockEmbeddingProvider();
    vectorService = new VectorService(mockDatabaseClient, mockEmbeddingProvider);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with correct embedding dimension', () => {
      expect(vectorService).toBeDefined();
      const faiss = require('faiss-node');
      expect(faiss.IndexFlatL2).toHaveBeenCalledWith(mockEmbeddingProvider.getDimension());
    });

    it('should handle empty metadata during index initialization', async () => {
      (mockDatabaseClient.getVectorIndexMetadata as jest.MockedFunction<any>).mockResolvedValue(null);
      
      await vectorService.initializeIndex();
      
      expect(mockDatabaseClient.getVectorIndexMetadata).toHaveBeenCalled();
      expect(mockDatabaseClient.getAllVectorsFromShards).not.toHaveBeenCalled();
    });

    it('should build index from existing vectors', async () => {
      const mockMetadata: VectorIndexMetadata = {
        activeWriteShard: 'shard1',
        shardCapacity: 10000,
        totalVectorCount: 2,
        shards: {
          shard1: { count: 2, createdAt: new Date().toISOString() }
        }
      };
      
      const mockVectors: VectorDataForFaiss[] = [
        {
          id: 'post1',
          type: 'post',
          vector: new Array(768).fill(0.1)
        },
        {
          id: 'reply1', 
          type: 'reply',
          vector: new Array(768).fill(0.2)
        }
      ];

      (mockDatabaseClient.getVectorIndexMetadata as jest.MockedFunction<any>).mockResolvedValue(mockMetadata);
      (mockDatabaseClient.getAllVectorsFromShards as jest.MockedFunction<any>).mockResolvedValue(mockVectors);

      await vectorService.initializeIndex();

      expect(mockDatabaseClient.getAllVectorsFromShards).toHaveBeenCalledWith(['shard1'], 10000);
      expect(mockFaissIndex.add).toHaveBeenCalledTimes(2);
    });
  });

  describe('addVector', () => {
    it('should generate embedding and add to index', async () => {
      const content = 'test content';
      const contentId = 'test123';
      const contentType = 'post' as const;

      (mockDatabaseClient.addVectorToShardStore as jest.MockedFunction<any>).mockResolvedValue(undefined);

      await vectorService.addVector(contentId, contentType, content);

      expect(mockFaissIndex.add).toHaveBeenCalled();
      expect(mockDatabaseClient.addVectorToShardStore).toHaveBeenCalled();
    });

    it('should handle embedding generation errors gracefully', async () => {
      const mockProvider = {
        generateEmbedding: (jest.fn() as any).mockRejectedValue(new Error('API Error')),
        getDimension: jest.fn().mockReturnValue(768)
      };
      
      const failingService = new VectorService(mockDatabaseClient, mockProvider as any);
      
      await expect(failingService.addVector('id', 'post', 'content'))
        .rejects.toThrow('API Error');
    });
  });

  describe('search', () => {
    it('should return search results with scores', async () => {
      const searchQuery = 'test query';
      const mockSearchResults = {
        distances: new Float32Array([0.1, 0.2, 0.3]),
        labels: new BigInt64Array([0n, 1n, 2n])
      };

      mockFaissIndex.search = jest.fn().mockReturnValue(mockSearchResults);
      
      // Mock the internal faissIdMap
      (vectorService as any).faissIdMap.set(0, { id: 'post1', type: 'post' });
      (vectorService as any).faissIdMap.set(1, { id: 'reply1', type: 'reply' });
      (vectorService as any).faissIdMap.set(2, { id: 'post2', type: 'post' });

      const results = await vectorService.searchVectors(searchQuery, 3);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        id: 'post1',
        type: 'post',
        score: 0.1
      });
      expect(mockFaissIndex.search).toHaveBeenCalledWith(expect.any(Float32Array), 3);
    });

    it('should handle empty search results', async () => {
      const searchQuery = 'test query';
      mockFaissIndex.search = jest.fn().mockReturnValue({
        distances: new Float32Array([]),
        labels: new BigInt64Array([])
      });

      const results = await vectorService.searchVectors(searchQuery, 10);

      expect(results).toHaveLength(0);
    });
  });

}); 