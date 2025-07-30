import logger from './logger.js';
import { FirebaseClient } from './db/FirebaseClient.js';
import { LoggedDatabaseClient } from './db/LoggedDatabaseClient.js';
import { VectorService } from './services/vectorService.js';
import { Post, Reply, VectorIndexEntry } from './types/index.js';
import dotenv from 'dotenv';
import { GCPEmbeddingProvider } from './services/gcpEmbeddingProvider.js';

// Load environment variables for GCP config needed by VectorService
dotenv.config();

async function backfillVectorEmbeddings(dbClient: LoggedDatabaseClient, vectorService: VectorService): Promise<void> {
    logger.info('Starting Vector Embedding Backfill Process...'); // Updated log message
    let processedPosts = 0;
    let processedReplies = 0;
    let failedPosts = 0;
    let failedReplies = 0;

    // 1. Fetch all posts
    logger.info('Fetching all posts...');
    // Use getRawPath which should be available on LoggedDatabaseClient
    const postsData = await dbClient.getRawPath('posts'); 
    const posts: Post[] = postsData ? Object.values(postsData) : [];
    logger.info(`Found ${posts.length} posts to process.`);

    for (const post of posts) {
        if (!post || !post.id || !post.content) {
            logger.warn('Skipping invalid post object:', post);
            failedPosts++;
            continue;
        }
        try {
            logger.debug(`Processing post ${post.id}...`);
            // Call addVector - it handles embedding and storing in the correct shard
            await vectorService.addVector(post.id, 'post', post.content);
            processedPosts++;
            logger.debug(`Successfully processed post ${post.id}`);
            // Add a small delay to avoid overwhelming Vertex AI or RTDB (optional)
            await new Promise(resolve => setTimeout(resolve, 50)); 
        } catch (error: any) {
            logger.error(`Failed to process vector for post ${post.id}: ${error.message}`, { err: error });
            failedPosts++;
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
    
    if (currentDbVersion !== '3') {
        logger.error(`Migration script expected database version '3' to run vector backfill, but found version '${currentDbVersion}'. Halting migration.`);
        throw new Error(`Migration prerequisite not met: Expected DB version '3', found '${currentDbVersion}'.`);
    }

    // Proceed only if currentDbVersion is '3'
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
