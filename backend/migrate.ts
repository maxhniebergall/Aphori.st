import logger from './logger.js';
import { LoggedDatabaseClient } from './db/LoggedDatabaseClient.js';
import { VectorService } from './services/vectorService.js';
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

export async function migrate(dbClient: LoggedDatabaseClient): Promise<void> {
    logger.info('Starting Data Migration Script (Vector Embedding Backfill Stage)...'); // Updated log
    const currentDbVersion = await dbClient.getDatabaseVersion() || '0'; // Get current version
    logger.info(`Current database version: ${currentDbVersion}`);

    const TARGET_VERSION = '4'; // Define target version for vector migration
    const MIGRATION_VERSION_STRING = '3->4';

    if (currentDbVersion === TARGET_VERSION) {
        logger.info(`Database is already at version ${TARGET_VERSION}. Skipping Vector Embedding Backfill.`);
        return; // Exit if already at target version
    }
    
    // Check if this is a valid state to run vector migration
    const isValidMigrationState = (
        currentDbVersion === '3' || // Fresh migration from version 3
        currentDbVersion === '3->4' || // Interrupted migration
        (typeof currentDbVersion === 'object' && currentDbVersion !== null && 
         'status' in currentDbVersion && currentDbVersion.status === "failed_vector_migration") // Failed migration retry
    );
    
    if (!isValidMigrationState) {
        logger.error(`Migration script cannot run vector backfill from current database version: ${JSON.stringify(currentDbVersion)}. Expected version '3', '3->4', or failed migration object.`);
        throw new Error(`Migration prerequisite not met: Invalid DB version for vector migration: ${JSON.stringify(currentDbVersion)}`);
    }

    // Proceed with vector migration from valid state
    logger.info(`Running Vector Embedding Backfill Migration (Version ${MIGRATION_VERSION_STRING})...`);

    try {
        // Database client is already connected when migration is called from server.ts
        logger.info("Using existing database connection for vector migration.");

        // Instantiate VectorService here, requires GEMINI_API_KEY from env
        const embeddingProvider = new GCPEmbeddingProvider(
            'gemini-embedding-exp-03-07',
            768
          );
        const vectorService = new VectorService(dbClient, embeddingProvider);

        await dbClient.setDatabaseVersion(MIGRATION_VERSION_STRING);
        await backfillVectorEmbeddings(dbClient, vectorService);
        // Note: backfillVectorEmbeddings logs its own errors but doesn't throw critical errors by default
        await dbClient.setDatabaseVersion(TARGET_VERSION);
        logger.info(`Vector embedding backfill script completed successfully. DatabaseVersion updated to: ${TARGET_VERSION}`);

    } catch (err: any) {
        const failureVersionInfo = { 
            current: `${TARGET_VERSION}_failed`, 
            fromVersion: currentDbVersion, // Should be '3' here
            toVersion: TARGET_VERSION, 
            status: "failed_vector_migration", 
            error: err.message,
            timestamp: new Date().toISOString()
        };
        try {
            await dbClient.setDatabaseVersion(failureVersionInfo);
            logger.error(`Vector migration (${MIGRATION_VERSION_STRING}) failed. DB version set to indicate failure. Error: ${err.message}`, { err });
        } catch (dbVersionError: any) {
            logger.error({ err: dbVersionError }, "CRITICAL: FAILED to set databaseVersion after vector migration script error. Manual check required.");
        }
        throw err; // Re-throw the error to indicate script failure
    } finally {
        logger.info("Migration script execution finished.");
    }
}
