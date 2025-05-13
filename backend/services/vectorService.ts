import { IndexFlatL2, IndexFlatIP } from 'faiss-node'; // Use IndexFlatL2 or IndexFlatIP based on Gemini embedding characteristics
import { VertexAI } from '@google-cloud/vertexai';
import { LoggedDatabaseClient } from '../db/LoggedDatabaseClient.js';
import { VectorIndexEntry, VectorIndexMetadata, VectorDataForFaiss } from '../types/index.js';
import { SHUTDOWN_TIMEOUT } from '../server.js';
import logger from '../logger.js';

const MAX_FAISS_INDEX_SIZE = 10000; // Configurable limit from design doc
const SHUTDOWN_WAIT_TIMEOUT_MS = SHUTDOWN_TIMEOUT - 5000; // Slightly less than server's timeout
if (SHUTDOWN_WAIT_TIMEOUT_MS <= 0) {
    throw new Error('SHUTDOWN_WAIT_TIMEOUT_MS must be greater than 0');
}

export class VectorService {
    // Use 'any' type for VertexAI client temporarily if exact type is problematic
    private vertexAI: any;
    private faissIndex: IndexFlatL2 | IndexFlatIP | null = null;
    private faissIdMap: Map<number, { id: string, type: 'post' | 'reply' }> = new Map();
    private embeddingDimension: number = 768; // Default/initial dimension
    private firebaseClient: LoggedDatabaseClient;
    private embeddingModelName = 'gemini-embedding-exp-03-07'; // As per design doc
    private pendingAddOperations: Set<Promise<any>> = new Set(); // Track in-flight addVector operations

    constructor(firebaseClient: LoggedDatabaseClient, gcpProjectId: string, gcpLocation: string) {
        this.firebaseClient = firebaseClient;
        // Correct instantiation based on documentation
        this.vertexAI = new VertexAI({ project: gcpProjectId, location: gcpLocation });
        this.faissIndex = new IndexFlatL2(this.embeddingDimension);
       logger.info('FAISS Index initialized (L2, dimension: ', this.embeddingDimension, ')');
    }

    // --- Initialization ---

    async initializeIndex(): Promise<void> {
       logger.info('Starting FAISS index initialization from RTDB...');
        this.faissIndex = new IndexFlatL2(this.embeddingDimension); // Re-instantiate with current dimension
        this.faissIdMap.clear();
       logger.info('FAISS Index re-initialized/reset.');

        try {
            const metadata: VectorIndexMetadata | null = await (this.firebaseClient as any).getVectorIndexMetadata();
            if (!metadata || !metadata.shards) {
               logger.info('No vector index metadata found in RTDB. Index will be empty.');
                return;
            }

            const shardKeys = Object.keys(metadata.shards);
           logger.info(`Found ${shardKeys.length} shards in metadata.`);

            const vectorsData: VectorDataForFaiss[] = await (this.firebaseClient as any).getAllVectorsFromShards(shardKeys, MAX_FAISS_INDEX_SIZE);

            if (metadata.totalVectorCount > MAX_FAISS_INDEX_SIZE) {
                logger.warn(`RTDB contains ${metadata.totalVectorCount} vectors, but FAISS index limit is ${MAX_FAISS_INDEX_SIZE}. Not all vectors will be loaded into memory.`);
            }

            if (vectorsData.length > 0 && this.faissIndex) {
                 // Ensure vectors match the index dimension before adding
                const currentDimension = this.embeddingDimension;
                const filteredVectorsData = vectorsData.filter(v => v.vector.length === currentDimension);
                if (filteredVectorsData.length !== vectorsData.length) {
                    logger.warn(`Filtered out ${vectorsData.length - filteredVectorsData.length} vectors due to dimension mismatch during load.`);
                }

                if (filteredVectorsData.length > 0) {
                    const vectors: number[][] = filteredVectorsData.map((v: VectorDataForFaiss) => v.vector);
                    for (const vector of vectors) {
                        // the documentation says that add() takes a matrix, but the type definition says it takes a single vector
                        this.faissIndex.add(vector);
                    }

                    // Map needs to correspond to the filtered vectors added
                    filteredVectorsData.forEach((vectorEntry: VectorDataForFaiss, index: number) => {
                        // The index here (0..N-1) is the internal FAISS index for the *added* vectors
                        // Store both id and type
                        this.faissIdMap.set(index, { id: vectorEntry.id, type: vectorEntry.type });
                    });
                   logger.info(`Successfully loaded ${this.faissIndex.ntotal()} vectors (matching dimension ${currentDimension}) into FAISS index.`);
                } else {
                    logger.info(`No vectors found with the correct dimension (${currentDimension}) to load.`);
                }
            } else {
               logger.info('No vectors found in specified shards or FAISS index not initialized.');
            }

        } catch (error) {
            logger.error('Error initializing FAISS index from RTDB:', error);
        }
    }

    // --- Embedding Generation ---

    async generateEmbedding(text: string): Promise<number[] | null> {
        try {
            // Use the GenerativeModel interface
            const generativeModel = this.vertexAI.getGenerativeModel({ model: this.embeddingModelName });
            const resp = await generativeModel.embedContent(text);
            
            // Accessing response based on typical SDK patterns
            const embeddingValues = resp?.response?.embeddings?.[0]?.values;

            if (!embeddingValues || embeddingValues.length === 0) {
                logger.error('Failed to generate embedding for text (no values received):', text);
                return null;
            }

            const generatedDimension = embeddingValues.length;

            // Handle dimension change: If the index exists and its dimension doesn't match,
            // or if the index doesn't exist yet, update our expected dimension and potentially reset the index.
            if (generatedDimension !== this.embeddingDimension) {
                 logger.error(`Generated embedding dimension (${generatedDimension}) differs from current service dimension (${this.embeddingDimension}). Discarding new embedding and using old dimension.`);
            }

            return embeddingValues;
        } catch (error: any) {
            logger.error('Error calling Vertex AI for embedding:', error.message || error);
            return null;
        }
    }

    // --- FAISS Index Operations ---

    async addVector(contentId: string, type: 'post' | 'reply', text: string): Promise<void> {
        const operationPromise = this._addVectorInternal(contentId, type, text);
        this.pendingAddOperations.add(operationPromise);

        // Ensure the promise is removed from the set once it settles
        operationPromise.finally(() => {
            this.pendingAddOperations.delete(operationPromise);
        });

       // Return the promise so callers *could* await it if needed, but routes currently don't
       return operationPromise;
    }

    private async _addVectorInternal(contentId: string, type: 'post' | 'reply', text: string): Promise<void> {
        // Ensure FAISS index is initialized before adding
        if (!this.faissIndex) {
           logger.info('FAISS index is null, initializing with current dimension:', this.embeddingDimension);
            this.faissIndex = new IndexFlatL2(this.embeddingDimension);
        }

        const vector = await this.generateEmbedding(text);
        if (!vector) {
            logger.error(`Failed to generate embedding for ${type} ${contentId}. Skipping add.`);
            // Still resolve void promise, but log error
            return;
        }

        // Double-check dimension consistency after embedding generation
        if (vector.length !== this.embeddingDimension) {
             logger.error(`Generated vector dimension (${vector.length}) unexpectedly differs from service dimension (${this.embeddingDimension}) after generation. Skipping add.`);
             return;
        }

        let addedToFaiss = false;
        if (this.faissIndex.ntotal() < MAX_FAISS_INDEX_SIZE) {
            try {
                const currentFaissInternalIndex = this.faissIndex.ntotal();

                 this.faissIndex.add(vector);
                this.faissIdMap.set(currentFaissInternalIndex, { id: contentId, type: type });
                addedToFaiss = true;
               logger.info(`Vector for ${contentId} added to in-memory FAISS index (new total: ${this.faissIndex.ntotal()}).`);
            } catch (error) {
                logger.error(`Error adding vector for ${contentId} to FAISS index:`, error);
                // Proceed to RTDB write even if FAISS add fails
            }
        } else {
            logger.warn(`FAISS index limit (${MAX_FAISS_INDEX_SIZE}) reached. Vector for ${contentId} not added to in-memory index, but will be saved to RTDB.`);
        }

        const vectorEntry: VectorIndexEntry = {
            vector: vector,
            type: type,
            createdAt: new Date().toISOString()
        };

        try {
            // This is the critical part that needs to complete before shutdown
            await (this.firebaseClient as any).addVectorToShardStore(contentId, vectorEntry);
           logger.info(`Vector for ${contentId} saved to RTDB vector store.`);
        } catch (error) {
            logger.error(`Error saving vector for ${contentId} to RTDB:`, error);
            if (addedToFaiss && this.faissIndex) {
                 // Potentially rollback FAISS add if RTDB fails? Complex, skip for now.
                 logger.error(`RTDB write failed for [${contentId}][${vectorEntry}], but it was added to FAISS.`);
            }
        }
    }

    async searchVectors(queryText: string, k: number): Promise<{ id: string, type: 'post' | 'reply', score: number }[]> {
        if (!this.faissIndex || this.faissIndex.ntotal() === 0) {
           logger.info('FAISS index is not initialized or empty. Cannot search.');
            return [];
        }

        const queryVector = await this.generateEmbedding(queryText);
        if (!queryVector) {
            logger.error('Failed to generate query embedding. Cannot search.');
            return [];
        }

        // Check dimension before search
        if (queryVector.length !== this.embeddingDimension) {
            logger.error(`Query vector dimension (${queryVector.length}) does not match service/index dimension (${this.embeddingDimension}). Cannot search.`);
            return [];
        }

        try {
            // Assuming search takes number[] based on faiss-node examples/common usage
            const results = this.faissIndex.search(queryVector, k);
            const { labels, distances } = results;

            if (!labels || !distances || labels.length === 0 || distances.length === 0) {
                logger.warn('FAISS search returned no labels or distances.');
                return [];
            }

            // Get id and type from map
            const searchResultInfo = labels.map((faissInternalIndex: number) => this.faissIdMap.get(faissInternalIndex))
                                           .filter(info => info !== undefined) as { id: string, type: 'post' | 'reply' }[];
            const searchResultScores: number[] = distances;

            // Combine IDs, types, and scores, ensuring arrays align
            const combinedResults = searchResultInfo.map((info, i) => ({ // Use info object
                id: info.id,
                type: info.type,
                score: searchResultScores[i] !== undefined ? searchResultScores[i] : Infinity // Handle potential misalignment
            })).filter(r => r.id && isFinite(r.score));

            return combinedResults;

        } catch (error) {
            logger.error('Error searching FAISS index:', error);
            return [];
        }
    }

    // --- Graceful Shutdown ---
    async handleShutdown(): Promise<void> {
       logger.info(`VectorService handling shutdown signal. Waiting for ${this.pendingAddOperations.size} pending operations...`);

        if (this.pendingAddOperations.size === 0) {
           logger.info("No pending vector operations to wait for.");
            return Promise.resolve();
        }

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Shutdown wait timed out after ${SHUTDOWN_WAIT_TIMEOUT_MS}ms`)), SHUTDOWN_WAIT_TIMEOUT_MS)
        );

        try {
            // Wait for all pending operations or timeout
            await Promise.race([
                Promise.allSettled(Array.from(this.pendingAddOperations)),
                timeoutPromise
            ]);
           logger.info(`Finished waiting for ${this.pendingAddOperations.size} pending operations that were still tracked.`);
            // Note: Some promises might have been removed from the set *during* the wait. The log reflects the count *at the start* of the wait.
        } catch (error) {
            // This catch block is specifically for the timeout error
            logger.error("Error during graceful shutdown wait:", error);
            // Log which operations might still be pending if possible/needed, although difficult now
        } finally {
            logger.info("VectorService shutdown processing complete.");
             // Clear the set just in case, though operations should have removed themselves
             this.pendingAddOperations.clear();
        }
    }
} 