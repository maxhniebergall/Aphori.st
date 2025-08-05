import logger from './logger.js';
import { LoggedDatabaseClient } from './db/LoggedDatabaseClient.js';
import { VectorService } from './services/vectorService.js';
import { DuplicateDetectionService } from './services/duplicateDetectionService.js';
import { Post, Reply } from './types/index.js';
import dotenv from 'dotenv';
import { GCPEmbeddingProvider } from './services/gcpEmbeddingProvider.js';
import { createHash } from 'crypto';

// Load environment variables for GCP config needed by VectorService
dotenv.config();

async function backfillVectorEmbeddings(dbClient: LoggedDatabaseClient, vectorService: VectorService): Promise<void> {
    logger.info('Starting Vector Embedding Backfill Process...'); // Updated log message
    let processedPosts = 0;
    let processedReplies = 0;
    let failedPosts = 0;
    let failedReplies = 0;
    const failedPostIds: string[] = [];
    const successfulPostIds: string[] = [];
    const skippedPostIds: string[] = [];

    // 1. Fetch all posts
    logger.info('Fetching all posts...');
    // Use getRawPath which should be available on LoggedDatabaseClient
    const postsData = await dbClient.getRawPath('posts'); 
    const posts: Post[] = postsData ? Object.values(postsData) : [];
    logger.info(`Found ${posts.length} posts to process.`);

    for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        if (!post || !post.id || !post.content) {
            logger.warn(`Skipping invalid post object at index ${i}:`, post);
            failedPosts++;
            if (post?.id) skippedPostIds.push(post.id);
            continue;
        }
        try {
            logger.info(`Processing post ${i + 1}/${posts.length}: ${post.id}...`);
            // Call addVector - it handles embedding and storing in the correct shard
            await vectorService.addVector(post.id, 'post', post.content);
            processedPosts++;
            successfulPostIds.push(post.id);
            logger.info(`Successfully processed post ${i + 1}/${posts.length}: ${post.id}`);
            // Add a small delay to avoid overwhelming Vertex AI or RTDB (optional)
            await new Promise(resolve => setTimeout(resolve, 50)); 
        } catch (error: any) {
            logger.error(`Failed to process vector for post ${i + 1}/${posts.length}: ${post.id}: ${error.message}`, { err: error });
            failedPosts++;
            failedPostIds.push(post.id);
        }
    }
    logger.info(`Finished processing posts. Success: ${processedPosts}, Failed: ${failedPosts}`);

    // 2. Fetch all replies
    logger.info('Fetching all replies...');
    const repliesData = await dbClient.getRawPath('replies');
    const replies: Reply[] = repliesData ? Object.values(repliesData) : [];
    logger.info(`Found ${replies.length} replies to process.`);

    for (const reply of replies) {
        if (!reply || !reply.id || !reply.text) {
            logger.warn('Skipping invalid reply object:', reply);
            failedReplies++;
            continue;
        }
        try {
            logger.debug(`Processing reply ${reply.id}...`);
            // Call addVector for reply
            await vectorService.addVector(reply.id, 'reply', reply.text);
            processedReplies++;
            logger.debug(`Successfully processed reply ${reply.id}`);
             // Add a small delay (optional)
             await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error: any) {
            logger.error(`Failed to process vector for reply ${reply.id}: ${error.message}`, { err: error });
            failedReplies++;
        }
    }
    logger.info(`Finished processing replies. Success: ${processedReplies}, Failed: ${failedReplies}`);

    logger.info(`Vector Embedding Backfill Process finished. Total Processed: Posts=${processedPosts}, Replies=${processedReplies}. Total Failed: Posts=${failedPosts}, Replies=${failedReplies}`); // Updated log message

    // Verify actual vector count vs processed count
    try {
        const metadata = await (dbClient as any).getVectorIndexMetadata();
        const actualVectorCount = metadata?.totalVectorCount || 0;
        const expectedProcessedCount = processedPosts + processedReplies;
        
        logger.info(`Vector count verification: Expected processed=${expectedProcessedCount}, Actual stored in metadata=${actualVectorCount}`);
        
        if (actualVectorCount !== expectedProcessedCount) {
            logger.warn(`DISCREPANCY DETECTED: Metadata shows ${actualVectorCount} vectors but we processed ${expectedProcessedCount} successfully. Difference: ${actualVectorCount - expectedProcessedCount}`);
            
            // Try to get actual vector count from shards
            if (metadata?.shards) {
                const shardKeys = Object.keys(metadata.shards);
                logger.info(`Checking actual vectors in ${shardKeys.length} shards...`);
                
                for (const shardKey of shardKeys) {
                    const shardPath = `vectorIndexStore/${shardKey}`;
                    const shardData = await dbClient.getRawPath(shardPath);
                    const actualShardCount = shardData ? Object.keys(shardData).length : 0;
                    const metadataShardCount = metadata.shards[shardKey]?.count || 0;
                    logger.info(`Shard ${shardKey}: metadata count=${metadataShardCount}, actual vectors=${actualShardCount}`);
                }
            }
        }
    } catch (error: any) {
        logger.error('Error during vector count verification:', error);
    }
    
    // Report which posts weren't properly ingested
    logger.info(`MIGRATION SUMMARY:`);
    logger.info(`- Successful posts: ${successfulPostIds.length} IDs: [${successfulPostIds.slice(0, 10).join(', ')}${successfulPostIds.length > 10 ? '...' : ''}]`);
    if (failedPostIds.length > 0) {
        logger.warn(`- Failed posts: ${failedPostIds.length} IDs: [${failedPostIds.join(', ')}]`);
    }
    if (skippedPostIds.length > 0) {
        logger.warn(`- Skipped posts: ${skippedPostIds.length} IDs: [${skippedPostIds.join(', ')}]`);
    }

    if (failedPosts > 0 || failedReplies > 0) {
        // Decide if failure is critical. For now, just log and maybe throw a warning-level error.
        logger.warn(`Vector embedding backfill completed with ${failedPosts} post failures and ${failedReplies} reply failures.`);
        // Optionally throw an error to halt further migrations if this is critical
        // throw new Error(`Vector migration completed with failures.`);
    }
}
// --- END: Vector Embedding Backfill Migration ---

// --- BEGIN: Reply Deduplication Migration ---
async function deduplicateExistingReplies(dbClient: LoggedDatabaseClient, vectorService: VectorService): Promise<void> {
    logger.info('Starting Reply Deduplication Process...');
    let processedReplies = 0;
    let duplicatesFound = 0;
    let duplicateGroupsCreated = 0;
    let failedReplies = 0;
    const failedReplyIds: string[] = [];
    
    // Local hashmap to track content -> original reply mapping
    // Key: normalized content hash, Value: { replyId, vector, reply }
    const contentToOriginalMap = new Map<string, { replyId: string; vector: number[]; reply: Reply }>();
    
    // Initialize duplicate detection service
    const duplicateDetectionService = new DuplicateDetectionService(vectorService, dbClient);
    
    // Helper function to normalize and hash content for deduplication
    function getContentHash(text: string): string {
        // Normalize whitespace and convert to lowercase for better duplicate detection
        const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
        // Use SHA-256 for collision-resistant hashing
        return createHash('sha256').update(normalized).digest('hex');
    }

    // 1. Fetch all existing replies
    logger.info('Fetching all existing replies for deduplication...');
    const repliesData = await dbClient.getRawPath('replies');
    const replies: Reply[] = repliesData ? Object.values(repliesData) : [];
    logger.info(`Found ${replies.length} replies to process for deduplication.`);

    // Sort replies by creation date to prioritize older replies as originals
    const sortedReplies = replies.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    for (let i = 0; i < sortedReplies.length; i++) {
        const reply = sortedReplies[i];
        if (!reply || !reply.id || !reply.text) {
            logger.warn(`Skipping invalid reply object at index ${i}:`, reply);
            failedReplies++;
            if (reply?.id) failedReplyIds.push(reply.id);
            continue;
        }

        try {
            logger.debug(`Processing reply ${i + 1}/${sortedReplies.length}: ${reply.id}...`);
            
            // Check if this reply already exists in a duplicate group
            const existingGroup = await duplicateDetectionService.findExistingDuplicateGroup(reply.id);
            if (existingGroup) {
                logger.debug(`Reply ${reply.id} already in duplicate group ${existingGroup.id}, skipping...`);
                processedReplies++;
                continue;
            }

            // Get content hash to check for duplicates
            const contentHash = getContentHash(reply.text);
            const existingOriginal = contentToOriginalMap.get(contentHash);
            
            if (!existingOriginal) {
                // This is the first occurrence of this content - mark as original and create vector
                logger.debug(`Reply ${reply.id} is original (first occurrence of content), creating vector...`);
                
                // Generate vector for this content
                const vector = await vectorService.generateEmbedding(reply.text);
                if (!vector) {
                    logger.error(`Failed to generate embedding for original reply ${reply.id}, skipping...`);
                    failedReplies++;
                    failedReplyIds.push(reply.id);
                    continue;
                }
                
                // Store in hashmap and add to vector service
                contentToOriginalMap.set(contentHash, { replyId: reply.id, vector, reply });
                await vectorService.addVector(reply.id, 'reply', reply.text);
                logger.debug(`Stored original reply ${reply.id} with content hash`);
                
            } else {
                // Content already exists - this is a duplicate!
                logger.info(`Reply ${reply.id} is a duplicate of original ${existingOriginal.replyId} (matching content)`);
                duplicatesFound++;

                // Calculate similarity score between this reply and the original
                const currentVector = await vectorService.generateEmbedding(reply.text);
                if (!currentVector) {
                    logger.error(`Failed to generate embedding for duplicate reply ${reply.id}, treating as unique...`);
                    await vectorService.addVector(reply.id, 'reply', reply.text);
                    continue;
                }
                
                // Calculate L2 distance (same as FAISS uses)
                const distance = Math.sqrt(
                    currentVector.reduce((sum, val, idx) => 
                        sum + Math.pow(val - existingOriginal.vector[idx], 2), 0
                    )
                );
                
                logger.info(`Creating duplicate group for original ${existingOriginal.replyId} and duplicate ${reply.id} (distance: ${distance.toFixed(4)})`);
                
                // Create new duplicate group
                const newGroup = await duplicateDetectionService.createDuplicateGroup(
                    existingOriginal.reply, // Original (first occurrence)
                    reply, // Duplicate (later occurrence) 
                    distance, // L2 distance score
                    { migrationContext: true }
                );
                duplicateGroupsCreated++;
                logger.info(`Created duplicate group ${newGroup.id}`);
            }

            processedReplies++;
            
            // Add a small delay to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 50));

        } catch (error: any) {
            logger.error(`Failed to process reply ${i + 1}/${sortedReplies.length}: ${reply.id}: ${error.message}`, { err: error });
            failedReplies++;
            failedReplyIds.push(reply.id);
        }
    }

    logger.info(`Reply Deduplication Process finished.`);
    logger.info(`- Processed: ${processedReplies} replies`);
    logger.info(`- Unique Content (Originals): ${contentToOriginalMap.size} replies`);
    logger.info(`- Duplicates Found: ${duplicatesFound} replies`);
    logger.info(`- Duplicate Groups Created: ${duplicateGroupsCreated} groups`);
    logger.info(`- Failed: ${failedReplies} replies`);

    if (failedReplyIds.length > 0) {
        logger.warn(`Failed to process replies: [${failedReplyIds.join(', ')}]`);
    }

    if (failedReplies > 0) {
        logger.warn(`Reply deduplication completed with ${failedReplies} failures.`);
    }
}
// --- END: Reply Deduplication Migration ---

export async function migrate(dbClient: LoggedDatabaseClient): Promise<void> {
    logger.info('Starting Data Migration Script (Vector Embedding Backfill & Deduplication Stage)...');
    const currentDbVersion = await dbClient.getDatabaseVersion() || '0';
    logger.info(`Current database version: ${currentDbVersion}`);

    const TARGET_VERSION = '5'; // Updated target version to include deduplication
    const VECTOR_MIGRATION_VERSION = '3->4';
    const DEDUPLICATION_MIGRATION_VERSION = '4->5';

    if (currentDbVersion === TARGET_VERSION) {
        logger.info(`Database is already at version ${TARGET_VERSION}. Skipping all migrations.`);
        return;
    }

    // Initialize embedding provider and vector service
    const embeddingProvider = new GCPEmbeddingProvider('gemini-embedding-exp-03-07', 768);
    const vectorService = new VectorService(dbClient, embeddingProvider);

    try {
        // STEP 1: Vector Embedding Backfill (if needed)
        const needsVectorMigration = (
            currentDbVersion === '3' || 
            currentDbVersion === '3->4' || 
            (typeof currentDbVersion === 'object' && currentDbVersion !== null && 
             'status' in currentDbVersion && currentDbVersion.status === "failed_vector_migration")
        );

        if (needsVectorMigration) {
            logger.info(`Running Vector Embedding Backfill Migration (Version ${VECTOR_MIGRATION_VERSION})...`);
            await dbClient.setDatabaseVersion(VECTOR_MIGRATION_VERSION);
            await backfillVectorEmbeddings(dbClient, vectorService);
            await dbClient.setDatabaseVersion('4');
            logger.info('Vector embedding backfill completed successfully.');
        } else if (currentDbVersion !== '4' && currentDbVersion !== '4->5') {
            logger.info('Vector embedding backfill already completed, skipping to deduplication...');
        }

        // STEP 2: Reply Deduplication (if needed)
        const needsDeduplicationMigration = (
            currentDbVersion === '4' || 
            currentDbVersion === '4->5' || 
            (typeof currentDbVersion === 'object' && currentDbVersion !== null && 
             'status' in currentDbVersion && currentDbVersion.status === "failed_deduplication_migration")
        );

        if (needsDeduplicationMigration) {
            logger.info(`Running Reply Deduplication Migration (Version ${DEDUPLICATION_MIGRATION_VERSION})...`);
            await dbClient.setDatabaseVersion(DEDUPLICATION_MIGRATION_VERSION);
            await deduplicateExistingReplies(dbClient, vectorService);
            await dbClient.setDatabaseVersion(TARGET_VERSION);
            logger.info('Reply deduplication completed successfully.');
        }

        logger.info(`All migrations completed successfully. Database updated to version: ${TARGET_VERSION}`);

    } catch (err: any) {
        const currentStage = currentDbVersion === VECTOR_MIGRATION_VERSION ? 'vector_migration' : 'deduplication_migration';
        const failureVersionInfo = { 
            current: `${TARGET_VERSION}_failed`, 
            fromVersion: currentDbVersion,
            toVersion: TARGET_VERSION, 
            status: `failed_${currentStage}`, 
            error: err instanceof Error ? err.message : 'Unknown error',
            timestamp: new Date().toISOString()
        };
        
        try {
            await dbClient.setDatabaseVersion(failureVersionInfo);
            logger.error(`Migration failed at ${currentStage}. DB version set to indicate failure. Error: ${failureVersionInfo.error}`, { err });
        } catch (dbVersionError: any) {
            logger.error({ err: dbVersionError }, "CRITICAL: FAILED to set databaseVersion after migration script error. Manual check required.");
        }
        throw err; // Re-throw the error to indicate script failure
    } finally {
        logger.info("Migration script execution finished.");
    }
}
