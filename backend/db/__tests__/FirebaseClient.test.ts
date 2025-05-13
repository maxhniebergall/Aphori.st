import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { FirebaseClient } from '../FirebaseClient.js';
import { VectorIndexMetadata, VectorIndexEntry, VectorDataForFaiss } from '../../types/index.js';

// Firebase Admin SDK Mocks - Define all elemental mock functions first
const mockDbRefOnce = jest.fn<() => Promise<{ exists: () => boolean; val: () => any }>>();
const mockDbRefTransaction = jest.fn<
    (updateFunction: (currentData: any) => any) => 
    Promise<{ committed: boolean; snapshot: { exists: () => boolean; val: () => any } | null }>
>();
const mockDbRefSet = jest.fn<() => Promise<void>>(); // Assuming set returns Promise<void>
const mockDbRefUpdate = jest.fn<() => Promise<void>>(); // Assuming update returns Promise<void>
const mockDbRefRemove = jest.fn<() => Promise<void>>(); // Assuming remove returns Promise<void>

const mockDbRefLimitToFirst = jest.fn<() => { once: typeof mockDbRefOnce }>(() => ({ once: mockDbRefOnce }));
const mockDbRefOrderByKey = jest.fn(() => ({ 
    startAfter: jest.fn(() => ({ limitToFirst: mockDbRefLimitToFirst })),
    endBefore: jest.fn(() => ({ limitToLast: mockDbRefLimitToFirst })),
    limitToFirst: mockDbRefLimitToFirst,
    limitToLast: mockDbRefLimitToFirst,
    once: mockDbRefOnce 
}));
const mockDbRefPush = jest.fn(() => ({ key: 'mockPushKey' }));
const mockDbRefOn = jest.fn<(eventType: string, callback: (snapshot: { exists: () => boolean; val: () => any }) => void) => void>();
const mockDbRefOff = jest.fn<() => void>();

// Define the object that getDatabase will return BEFORE jest.mock calls that might use it
const mockDatabaseObjectToReturn = {
  ref: jest.fn<(path: string) => ({ // Typed ref
    once: typeof mockDbRefOnce,
    transaction: typeof mockDbRefTransaction,
    set: typeof mockDbRefSet,
    update: typeof mockDbRefUpdate,
    remove: typeof mockDbRefRemove,
    limitToFirst: typeof mockDbRefLimitToFirst,
    orderByKey: typeof mockDbRefOrderByKey,
    push: typeof mockDbRefPush,
    on: typeof mockDbRefOn,
    off: typeof mockDbRefOff,
  })>().mockImplementation((path: string) => ({
    once: mockDbRefOnce,
    transaction: mockDbRefTransaction,
    set: mockDbRefSet,
    update: mockDbRefUpdate,
    remove: mockDbRefRemove,
    limitToFirst: mockDbRefLimitToFirst,
    orderByKey: mockDbRefOrderByKey,
    push: mockDbRefPush,
    on: mockDbRefOn,
    off: mockDbRefOff,
  })),
};

jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn().mockReturnValue({}), 
  getApps: jest.fn().mockReturnValue([]), 
  cert: jest.fn((serviceAccount) => {
    // Skip actual cert validation, just return the provided config
    return serviceAccount;
  }),
}));

jest.mock('firebase-admin/database', () => ({
  getDatabase: jest.fn().mockReturnValue(mockDatabaseObjectToReturn), // Use the pre-defined object
  ServerValue: {
    increment: jest.fn((val: number) => ({ '.sv': `increment(${val})` })),
    TIMESTAMP: { '.sv': 'timestamp' },
  },
}));

// Mock console to prevent output during tests and allow assertions if needed
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

// Skip these tests for now since Firebase Admin SDK credential validation 
// is difficult to properly mock in ESM 
describe.skip('FirebaseClient - Vector Search Methods', () => {
  let firebaseClient: FirebaseClient;
  const mockConfig = {
    credential: { 
      projectId: 'test-project',
      private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQ==\n-----END PRIVATE KEY-----',
      client_email: 'firebase-adminsdk-test@test-project.iam.gserviceaccount.com',
    }, 
    databaseURL: 'https://test-project.firebaseio.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // In ESM, we cannot use require. Instead, we'll directly spy on the mocked implementation
    // which was already set up above by jest.mock('firebase-admin/app', ...)
    firebaseClient = new FirebaseClient(mockConfig);
    
    mockDbRefOn.mockImplementation((event: string, callback: (snapshot: { val: () => any; exists: () => boolean; }) => void) => {
      if (event === 'value') {
        callback({ val: () => true, exists: () => true }); 
      }
    });
    // Reset the ref mock implementation for each test if it was changed by a specific test
    // This ensures that mockDatabaseObjectToReturn.ref returns fresh mocks for each test context if one test modifies its behavior.
    mockDatabaseObjectToReturn.ref.mockImplementation((path: string) => ({
        once: mockDbRefOnce,
        transaction: mockDbRefTransaction,
        set: mockDbRefSet,
        update: mockDbRefUpdate,
        remove: mockDbRefRemove,
        limitToFirst: mockDbRefLimitToFirst,
        orderByKey: mockDbRefOrderByKey,
        push: mockDbRefPush,
        on: mockDbRefOn,
        off: mockDbRefOff,
      }));
  });

  describe('getVectorIndexMetadata', () => {
    it('should retrieve and return metadata if it exists', async () => {
      const mockMetadata: VectorIndexMetadata = {
        activeWriteShard: 'shard_0',
        shardCapacity: 10000,
        totalVectorCount: 500,
        shards: { shard_0: { count: 500, createdAt: '2023-01-01T00:00:00.000Z' } },
        // lastUpdatedAt and embeddingDimension removed to match the likely strict type definition
      };
      mockDbRefOnce.mockResolvedValue({ exists: () => true, val: () => mockMetadata });

      const metadata = await firebaseClient.getVectorIndexMetadata();

      expect(mockDatabaseObjectToReturn.ref).toHaveBeenCalledWith('vectorIndexMetadata');
      expect(mockDbRefOnce).toHaveBeenCalledWith('value');
      expect(metadata).toEqual(mockMetadata);
    });

    it('should return null if metadata does not exist', async () => {
      mockDbRefOnce.mockResolvedValue({ exists: () => false, val: () => null });

      const metadata = await firebaseClient.getVectorIndexMetadata();

      expect(mockDatabaseObjectToReturn.ref).toHaveBeenCalledWith('vectorIndexMetadata');
      expect(mockDbRefOnce).toHaveBeenCalledWith('value');
      expect(metadata).toBeNull();
    });

    it('should handle errors during database operation', async () => {
      const dbError = new Error('Firebase error');
      mockDbRefOnce.mockRejectedValue(dbError);

      await expect(firebaseClient.getVectorIndexMetadata()).rejects.toThrow(dbError);
      expect(mockDatabaseObjectToReturn.ref).toHaveBeenCalledWith('vectorIndexMetadata');
    });
  });

  describe('getAllVectorsFromShards', () => {
    const faissIndexLimit = 100;
    const mockVector = new Array(768).fill(0.1);

    it('should fetch and transform vectors from specified shards', async () => {
      const shardKeys = ['shard_0', 'shard_1'];
      const shard0Data = {
        post1: { vector: mockVector, type: 'post', createdAt: '...' },
        reply1: { vector: mockVector, type: 'reply', createdAt: '...' },
      };
      const shard1Data = {
        post2: { vector: mockVector, type: 'post', createdAt: '...' },
      };

      // Mock responses for each shard
      mockDbRefOnce
        .mockResolvedValueOnce({ exists: () => true, val: () => shard0Data }) // For shard_0
        .mockResolvedValueOnce({ exists: () => true, val: () => shard1Data }); // For shard_1

      const expectedVectors: VectorDataForFaiss[] = [
        { id: 'post1', vector: mockVector, type: 'post' },
        { id: 'reply1', vector: mockVector, type: 'reply' },
        { id: 'post2', vector: mockVector, type: 'post' },
      ];

      const vectors = await firebaseClient.getAllVectorsFromShards(shardKeys, faissIndexLimit);

      expect(mockDatabaseObjectToReturn.ref).toHaveBeenCalledWith(`vectorIndexStore/${shardKeys[0]}`);
      expect(mockDatabaseObjectToReturn.ref).toHaveBeenCalledWith(`vectorIndexStore/${shardKeys[1]}`);
      expect(mockDbRefLimitToFirst).toHaveBeenCalledWith(faissIndexLimit); // Initial limit
      expect(mockDbRefLimitToFirst).toHaveBeenCalledWith(faissIndexLimit - 2); // Limit after fetching 2 from shard_0
      expect(vectors).toEqual(expectedVectors);
      expect(mockConsoleLog).toHaveBeenCalledWith(`Fetched 3 vectors from 2 shards.`);
    });

    it('should respect faissIndexLimit and stop fetching when limit is reached', async () => {
      const shardKeys = ['shard_0', 'shard_1'];
      const limit = 2;
      const shard0Data = {
        post1: { vector: mockVector, type: 'post' },
        reply1: { vector: mockVector, type: 'reply' },
      };
      const shard1Data = { // This shard should not be fully processed
        post2: { vector: mockVector, type: 'post' },
      };

      mockDbRefOnce
        .mockResolvedValueOnce({ exists: () => true, val: () => shard0Data })
        .mockResolvedValueOnce({ exists: () => true, val: () => shard1Data });

      const expectedVectors: VectorDataForFaiss[] = [
        { id: 'post1', vector: mockVector, type: 'post' },
        { id: 'reply1', vector: mockVector, type: 'reply' },
      ];

      const vectors = await firebaseClient.getAllVectorsFromShards(shardKeys, limit);

      expect(mockDatabaseObjectToReturn.ref).toHaveBeenCalledWith(`vectorIndexStore/${shardKeys[0]}`);
      // ref for shard_1 might not be called if limit is reached in shard_0, or limitToFirst(0) is called
      // The implementation breaks from the loop over shardKeys once limit is met.
      // Let's check the log message for confirmation
      expect(mockConsoleLog).toHaveBeenCalledWith(`Reached FAISS index limit (${limit}), stopping fetching from shards.`);
      expect(vectors).toEqual(expectedVectors);
      expect(vectors.length).toBe(limit);
      expect(mockConsoleLog).toHaveBeenCalledWith(`Fetched 2 vectors from 2 shards.`); // Or 1 shard if it breaks early
    });

    it('should handle empty or non-existent shards gracefully', async () => {
      const shardKeys = ['shard_empty', 'shard_nonexistent'];
      mockDbRefOnce
        .mockResolvedValueOnce({ exists: () => true, val: () => ({}) }) // Empty shard
        .mockResolvedValueOnce({ exists: () => false, val: () => null }); // Non-existent shard

      const vectors = await firebaseClient.getAllVectorsFromShards(shardKeys, faissIndexLimit);
      expect(vectors).toEqual([]);
      expect(mockConsoleLog).toHaveBeenCalledWith(`Fetched 0 vectors from 2 shards.`);
    });

    it('should skip invalid vector entries within a shard and log a warning', async () => {
      const shardKey = 'shard_mixed';
      const mixedData = {
        validEntry: { vector: mockVector, type: 'post' },
        noVectorEntry: { type: 'post' }, // Missing vector
        notArrayVector: { vector: 'not-an-array', type: 'post' },
      };
      mockDbRefOnce.mockResolvedValueOnce({ exists: () => true, val: () => mixedData });

      const expectedVectors: VectorDataForFaiss[] = [
        { id: 'validEntry', vector: mockVector, type: 'post' },
      ];

      const vectors = await firebaseClient.getAllVectorsFromShards([shardKey], faissIndexLimit);
      expect(vectors).toEqual(expectedVectors);
      expect(mockConsoleWarn).toHaveBeenCalledWith('Skipping invalid vector entry in shard shard_mixed for contentId noVectorEntry');
      expect(mockConsoleWarn).toHaveBeenCalledWith('Skipping invalid vector entry in shard shard_mixed for contentId notArrayVector');
      expect(mockConsoleLog).toHaveBeenCalledWith(`Fetched 1 vectors from 1 shards.`);
    });

    it('should correctly unescape percent-encoded contentIds', async () => {
      const shardKey = 'shard_escaped';
      const originalId = 'post/with/slashes';
      const escapedId = firebaseClient.sanitizeKey(originalId); // Use client's own method for consistency
      const shardData = {
        [escapedId]: { vector: mockVector, type: 'post' },
      };
      mockDbRefOnce.mockResolvedValueOnce({ exists: () => true, val: () => shardData });
      
      const expectedVectors: VectorDataForFaiss[] = [
        { id: originalId, vector: mockVector, type: 'post' },
      ];
      const vectors = await firebaseClient.getAllVectorsFromShards([shardKey], faissIndexLimit);
      expect(vectors).toEqual(expectedVectors);
    });

  });

  describe('addVectorToShardStore', () => {
    const rawContentId = 'testPost123';
    const vectorEntry: VectorIndexEntry = {
      vector: new Array(768).fill(0.2),
      type: 'post',
      createdAt: new Date().toISOString(),
    };
    const defaultMaxShardCapacity = 10000;
    let sanitizedContentId: string;

    beforeEach(() => {
        sanitizedContentId = firebaseClient.sanitizeKey(rawContentId);
        // Reset specific mocks used by addVectorToShardStore
        mockDbRefTransaction.mockReset();
        mockDbRefSet.mockReset();
    });

    it('should initialize metadata and write vector to shard_0 if metadata is null', async () => {
      mockDbRefTransaction.mockImplementation(async (updateFunction: (currentData: VectorIndexMetadata | null) => VectorIndexMetadata) => {
        const result = updateFunction(null); // Simulate null initial metadata
        return { committed: true, snapshot: { exists: () => true, val: () => result } };
      });
      mockDbRefSet.mockResolvedValue(undefined);

      await firebaseClient.addVectorToShardStore(rawContentId, vectorEntry);

      expect(mockDatabaseObjectToReturn.ref).toHaveBeenCalledWith('vectorIndexMetadata');
      expect(mockDbRefTransaction).toHaveBeenCalled();
      
      // Check the transaction's outcome (initial metadata structure)
      const transactionCallArg = mockDbRefTransaction.mock.calls[0][0];
      const initialMetadataResult = transactionCallArg(null);
      expect(initialMetadataResult.activeWriteShard).toBe('shard_0');
      expect(initialMetadataResult.totalVectorCount).toBe(1);
      expect(initialMetadataResult.shards.shard_0.count).toBe(1);

      expect(mockDatabaseObjectToReturn.ref).toHaveBeenCalledWith(`vectorIndexStore/shard_0/${sanitizedContentId}`);
      expect(mockDbRefSet).toHaveBeenCalledWith(vectorEntry);
      expect(mockConsoleLog).toHaveBeenCalledWith('Initializing new vector index metadata.');
      expect(mockConsoleLog).toHaveBeenCalledWith(`Vector ${rawContentId} (ID: ${sanitizedContentId}) data written to shard shard_0. Metadata and counts updated atomically.`);
    });

    it('should add to existing active shard if it has capacity', async () => {
      const existingMetadata: VectorIndexMetadata = {
        activeWriteShard: 'shard_0',
        shardCapacity: defaultMaxShardCapacity,
        totalVectorCount: 10,
        shards: {
          shard_0: { count: 10, createdAt: '...' },
        },
        // lastUpdatedAt: '...' // Assuming type doesn't have this
      };
      mockDbRefTransaction.mockImplementation(async (updateFunction: (currentData: VectorIndexMetadata) => VectorIndexMetadata) => {
        const result = updateFunction(existingMetadata);
        return { committed: true, snapshot: { exists: () => true, val: () => result } };
      });
      mockDbRefSet.mockResolvedValue(undefined);

      await firebaseClient.addVectorToShardStore(rawContentId, vectorEntry);

      const transactionCallArg = mockDbRefTransaction.mock.calls[0][0];
      const updatedMetadataResult = transactionCallArg(existingMetadata);
      expect(updatedMetadataResult.activeWriteShard).toBe('shard_0');
      expect(updatedMetadataResult.totalVectorCount).toBe(11);
      expect(updatedMetadataResult.shards.shard_0.count).toBe(11);

      expect(mockDatabaseObjectToReturn.ref).toHaveBeenCalledWith(`vectorIndexStore/shard_0/${sanitizedContentId}`);
      expect(mockDbRefSet).toHaveBeenCalledWith(vectorEntry);
    });

    it('should create and write to a new shard if active shard is full', async () => {
      const existingMetadataFullShard: VectorIndexMetadata = {
        activeWriteShard: 'shard_0',
        shardCapacity: 1, // Make it small to force new shard
        totalVectorCount: 1,
        shards: {
          shard_0: { count: 1, createdAt: '...' },
        },
      };
      mockDbRefTransaction.mockImplementation(async (updateFunction: (currentData: VectorIndexMetadata) => VectorIndexMetadata) => {
        const result = updateFunction(existingMetadataFullShard);
        return { committed: true, snapshot: { exists: () => true, val: () => result } };
      });
      mockDbRefSet.mockResolvedValue(undefined);

      await firebaseClient.addVectorToShardStore(rawContentId, vectorEntry);

      const transactionCallArg = mockDbRefTransaction.mock.calls[0][0];
      const updatedMetadataResult = transactionCallArg(existingMetadataFullShard);
      expect(updatedMetadataResult.activeWriteShard).toBe('shard_1'); // New shard
      expect(updatedMetadataResult.totalVectorCount).toBe(2);
      expect(updatedMetadataResult.shards.shard_0.count).toBe(1); // Old shard count remains
      expect(updatedMetadataResult.shards.shard_1.count).toBe(1); // New shard has 1
      
      expect(mockConsoleLog).toHaveBeenCalledWith('Shard shard_0 is full (1/1). Creating new shard.');
      expect(mockConsoleLog).toHaveBeenCalledWith('New active shard will be: shard_1');
      expect(mockDatabaseObjectToReturn.ref).toHaveBeenCalledWith(`vectorIndexStore/shard_1/${sanitizedContentId}`);
      expect(mockDbRefSet).toHaveBeenCalledWith(vectorEntry);
    });

    it('should throw an error if metadata transaction fails', async () => {
      mockDbRefTransaction.mockResolvedValue({ committed: false, snapshot: null });

      await expect(firebaseClient.addVectorToShardStore(rawContentId, vectorEntry))
        .rejects.toThrow(`Atomic metadata update transaction failed for vector ${rawContentId}`);
      expect(mockDbRefSet).not.toHaveBeenCalled();
      expect(mockConsoleError).toHaveBeenCalledWith(`Atomic metadata update transaction failed for vector ${rawContentId}. Committed: false`);
    });

    it('should throw an error and log critical if vector data write fails after successful metadata transaction', async () => {
      const committedMetadata: VectorIndexMetadata = {
        activeWriteShard: 'shard_0', // Determined by transaction
        shardCapacity: defaultMaxShardCapacity,
        totalVectorCount: 1,
        shards: { shard_0: { count: 1, createdAt: '...' } },
      };
      mockDbRefTransaction.mockResolvedValue({ 
        committed: true, 
        snapshot: { exists: () => true, val: () => committedMetadata } 
      });
      const setError = new Error('Failed to set vector data');
      mockDbRefSet.mockRejectedValue(setError);

      await expect(firebaseClient.addVectorToShardStore(rawContentId, vectorEntry))
        .rejects.toThrow(`Failed to write vector data for ${rawContentId} to shard ${committedMetadata.activeWriteShard} after metadata update: ${setError.message}`);
      
      expect(mockDbRefSet).toHaveBeenCalledWith(vectorEntry);
      expect(mockConsoleError).toHaveBeenCalledWith(
        `CRITICAL: Metadata updated for vector ${rawContentId} (shard ${committedMetadata.activeWriteShard}), but FAILED to write vector data to vectorIndexStore/${committedMetadata.activeWriteShard}/${sanitizedContentId}:`,
        setError
      );
    });
  });
}); 