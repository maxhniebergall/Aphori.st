import faiss from 'faiss-node';
import { LoggedDatabaseClient } from '../db/LoggedDatabaseClient.js';
import { VectorIndexEntry, VectorIndexMetadata, VectorDataForFaiss } from '../types/index.js';
import { SHUTDOWN_TIMEOUT } from '../server.js';
import logger from '../logger.js';
import { MAX_POST_LENGTH } from '../routes/posts.js';
import { EmbeddingProvider } from './embeddingProvider.js';

const MAX_FAISS_INDEX_SIZE = 10000; // Configurable limit from design doc
const SHUTDOWN_WAIT_TIMEOUT_MS = SHUTDOWN_TIMEOUT - 5000; // Slightly less than server's timeout
const MAX_EMBEDDING_TEXT_LENGTH = 8000; // Vertex AI limit
const MIN_EMBEDDING_TEXT_LENGTH = 3;

if (SHUTDOWN_WAIT_TIMEOUT_MS <= 0) {
    throw new Error('SHUTDOWN_WAIT_TIMEOUT_MS must be greater than 0');
}

export class VectorService {
    private embeddingProvider: EmbeddingProvider;
    private faissIndex: faiss.IndexFlatL2 | faiss.IndexFlatIP | null = null;
    private faissIdMap: Map<number, { id: string, type: 'post' | 'reply' }> = new Map();
    private embeddingDimension: number;
    private firebaseClient: LoggedDatabaseClient;
    private pendingAddOperations: Set<Promise<any>> = new Set(); // Track in-flight addVector operations

    constructor(firebaseClient: LoggedDatabaseClient, embeddingProvider: EmbeddingProvider) {
        this.firebaseClient = firebaseClient;
        this.embeddingProvider = embeddingProvider;
        this.embeddingDimension = this.embeddingProvider.getDimension();
        
        this.faissIndex = new faiss.IndexFlatL2(this.embeddingDimension);
        logger.info('FAISS Index initialized (L2, dimension: ', this.embeddingDimension, ') via EmbeddingProvider.');
    }

    // --- Initialization ---

    async initializeIndex(): Promise<void> {
       logger.info('Starting FAISS index initialization from RTDB...');
        
        // Check for existing vectors and validate dimensions before reset
        try {
            const metadata: VectorIndexMetadata | null = await (this.firebaseClient as any).getVectorIndexMetadata();
            if (metadata && metadata.shards && Object.keys(metadata.shards).length > 0) {
                const shardKeys = Object.keys(metadata.shards);
                const vectorsData: VectorDataForFaiss[] = await (this.firebaseClient as any).getAllVectorsFromShards(shardKeys, 10); // Sample first 10 vectors
                
                if (vectorsData.length > 0) {
                    const existingDimensions = [...new Set(vectorsData.map(v => v.vector.length))];
                    const newDimension = this.embeddingDimension;
                    
                    // If there are existing vectors with different dimensions, prevent reset
                    if (existingDimensions.length > 0 && !existingDimensions.includes(newDimension)) {
                        const existingDimension = existingDimensions[0]; // Use first found dimension
                        logger.warn(`Dimension mismatch: existing vectors have dimension ${existingDimension}, service expects ${newDimension}`);
                        throw new Error('Dimension mismatch requires manual migration. Cannot automatically reset FAISS index with existing vectors.');
                    }
                }
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('Dimension mismatch requires manual migration')) {
                throw error; // Re-throw dimension mismatch errors
            }
            logger.warn('Warning during dimension validation (continuing with initialization):', error);
        }
        
        this.faissIndex = new faiss.IndexFlatL2(this.embeddingDimension); // Re-instantiate with current dimension
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
                 // Check for dimension consistency issues before loading
                const currentDimension = this.embeddingDimension;
                const dimensionCounts = new Map<number, number>();
                
                // Count vectors by dimension
                vectorsData.forEach(v => {
                    const dim = v.vector.length;
                    dimensionCounts.set(dim, (dimensionCounts.get(dim) || 0) + 1);
                });
                
                const uniqueDimensions = Array.from(dimensionCounts.keys());
                
                // Check for dimension mismatch problems
                if (uniqueDimensions.length > 1) {
                    logger.warn(`DIMENSION INCONSISTENCY DETECTED: Found vectors with ${uniqueDimensions.length} different dimensions:`, 
                        Object.fromEntries(dimensionCounts));
                    logger.warn(`Current service dimension: ${currentDimension}`);
                }
                
                const filteredVectorsData = vectorsData.filter(v => v.vector.length === currentDimension);
                const filteredCount = vectorsData.length - filteredVectorsData.length;
                
                if (filteredCount > 0) {
                    logger.warn(`PRODUCTION WARNING: Filtered out ${filteredCount} vectors due to dimension mismatch during FAISS index load.`);
                    logger.warn(`This may indicate a dimension change or data corruption. Review vector storage consistency.`);
                    
                    // In production, we might want to be more strict
                    if (filteredCount > vectorsData.length * 0.1) { // If >10% of vectors are filtered
                        logger.error(`CRITICAL: More than 10% of vectors (${filteredCount}/${vectorsData.length}) have dimension mismatches.`);
                        logger.error(`Consider manual inspection before proceeding. Service dimension: ${currentDimension}`);
                    }
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

    // --- Vector Validation ---

    private validateVector(vector: number[]): void {
        if (!Array.isArray(vector)) {
            throw new Error('Vector must be an array');
        }
        
        if (vector.length === 0) {
            throw new Error('Vector cannot be empty');
        }
        
        if (vector.some(v => typeof v !== 'number' || !isFinite(v))) {
            throw new Error('All vector elements must be finite numbers');
        }
        
        if (vector.length !== this.embeddingDimension) {
            throw new Error(`Vector dimension mismatch: expected ${this.embeddingDimension}, got ${vector.length}`);
        }
    }

    private sanitizeEmbeddingText(text: string): string {
        return text
            .trim()
            .replace(/[\x00-\x1F\x7F]/g, '') // Control characters
            .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width spaces
            .replace(/\s+/g, ' ') // Normalize whitespace
            .slice(0, MAX_EMBEDDING_TEXT_LENGTH);
    }

    // --- Embedding Generation ---

    async generateEmbedding(text: string): Promise<number[] | null> {
        if (typeof text !== 'string') {
            throw new Error('generateEmbedding called with non-string argument: [' + text + '] typeof [' + typeof text + ']');
        }

        const sanitizedText = this.sanitizeEmbeddingText(text);

        if (sanitizedText.length === 0) {
            throw new Error('generateEmbedding called with empty string after sanitization');
        }

        if (sanitizedText.length < MIN_EMBEDDING_TEXT_LENGTH) {
            throw new Error(`Text too short for embedding: ${sanitizedText.length} chars`);
        }

        if (text.length > MAX_POST_LENGTH) {
            throw new Error('generateEmbedding called with string longer than [' + MAX_POST_LENGTH + '] characters, was [' + text.length + ']');
        }
        try {
            const embeddingValues = await this.embeddingProvider.generateEmbedding(sanitizedText);

            if (!embeddingValues || embeddingValues.length === 0) {
                logger.error('Failed to generate embedding for text (no values received from provider):', text);
                return null;
            }

            const generatedDimension = embeddingValues.length;

            if (generatedDimension !== this.embeddingDimension) {
                 logger.error(`Generated embedding dimension (${generatedDimension}) from provider differs from service dimension (${this.embeddingDimension}). Discarding new embedding.`);
                 // This case should ideally be prevented by the provider ensuring consistent dimension, 
                 // or by re-initializing the FAISS index if a dimension change is intentional and supported.
                 // For now, we'll log an error and return null.
                 return null; 
            }

            return embeddingValues;
        } catch (error: any) {
            logger.error('Error calling EmbeddingProvider for embedding:', error.message || error);
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
        if (!this.faissIndex) {
            logger.info('FAISS index is null, initializing with current dimension:', this.embeddingDimension);
            this.faissIndex = new faiss.IndexFlatL2(this.embeddingDimension);
        }

        const vector = await this.generateEmbedding(text);
        if (!vector) {
            logger.error(`Failed to generate embedding for ${type} ${contentId}. Skipping add.`);
            return;
        }

        try {
            this.validateVector(vector);
        } catch (error) {
            logger.error(`Vector validation failed for ${type} ${contentId}: ${(error as Error).message}. Skipping add.`);
            return;
        }

        const vectorEntry: VectorIndexEntry = {
            vector: vector,
            type: type,
            createdAt: new Date().toISOString()
        };

        try {
            await (this.firebaseClient as any).addVectorToShardStore(contentId, vectorEntry);
            logger.info(`Vector for ${contentId} saved to RTDB vector store.`);
        } catch (error) {
            logger.error(`Error saving vector for ${contentId} to RTDB:`, error);
            return;
        }

        if (this.faissIndex.ntotal() < MAX_FAISS_INDEX_SIZE) {
            try {
                const currentFaissInternalIndex = this.faissIndex.ntotal();
                this.faissIndex.add(vector);
                this.faissIdMap.set(currentFaissInternalIndex, { id: contentId, type: type });
                logger.info(`Vector for ${contentId} added to in-memory FAISS index (new total: ${this.faissIndex.ntotal()}).`);
            } catch (error) {
                logger.error(`Error adding vector for ${contentId} to FAISS index:`, error);
                // If FAISS add fails after successful RTDB write, we have an inconsistency.
                // For now, we log this. A more robust solution would be a reconciliation process.
                logger.error(`CRITICAL INCONSISTENCY: Vector for ${contentId} saved to RTDB but failed to add to FAISS.`);
            }
        } else {
            logger.warn(`FAISS index limit (${MAX_FAISS_INDEX_SIZE}) reached. Vector for ${contentId} not added to in-memory index, but was saved to RTDB.`);
        }
    }

    async searchVectors(queryText: string, k: number): Promise<{ id: string, type: 'post' | 'reply', score: number }[]> {
        // Validate k parameter bounds
        if (!Number.isInteger(k) || k <= 0) {
            throw new Error(`Invalid k parameter: must be a positive integer, got ${k}`);
        }
        
        if (k > 100) {
            throw new Error(`Invalid k parameter: maximum value is 100, got ${k}`);
        }
        if (!this.faissIndex || this.faissIndex.ntotal() === 0) {
           logger.info('FAISS index is not initialized or empty. Cannot search.');
            return [];
        }

        const queryVector = await this.generateEmbedding(queryText);
        if (!queryVector) {
            logger.error('Failed to generate query embedding. Cannot search.');
            return [];
        }

        if (queryVector.length !== this.embeddingDimension) {
            logger.error(`Query vector dimension (${queryVector.length}) does not match service/index dimension (${this.embeddingDimension}). Cannot search.`);
            return [];
        }

        const totalVectors = this.faissIndex.ntotal();
        let effectiveK = k;

        if (!Number.isInteger(k) || k <= 0) {
            logger.warn(`Requested k=${k} is not a positive integer. Defaulting to 10.`);
            effectiveK = 10;
        }

        if (effectiveK > totalVectors) {
            logger.warn(`Requested k=${effectiveK} is greater than the total number of vectors (${totalVectors}). Adjusting k to ${totalVectors}.`);
            effectiveK = totalVectors;
        }

        try {
            const results = this.faissIndex.search(queryVector, effectiveK);
            const { labels, distances } = results;

            if (!labels || !distances || labels.length === 0 || distances.length === 0) {
                logger.warn('FAISS search returned no labels or distances.');
                return [];
            }

            const searchResultInfo = labels.map((faissInternalIndex: number) => this.faissIdMap.get(faissInternalIndex))
                                           .filter(info => info !== undefined) as { id: string, type: 'post' | 'reply' }[];
            const searchResultScores: number[] = distances;

            const combinedResults = searchResultInfo.map((info, i) => ({
                id: info.id,
                type: info.type,
                score: searchResultScores[i] !== undefined ? searchResultScores[i] : Infinity
            })).filter(r => r.id && Number.isFinite(r.score));

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