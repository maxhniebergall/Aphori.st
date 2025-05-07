import logger from './logger.js';
import { Post, FeedItem, DatabaseClient } from './types/index.js';
import { DatabaseCompression } from './db/DatabaseCompression.js'; // Needed ONLY for old data decompression    
import { FirebaseClient } from './db/FirebaseClient.js'; // Needed for direct path access/sanitization logic if dbClient doesn't expose it
import { LoggedDatabaseClient } from './db/LoggedDatabaseClient.js'; // <--- ADD THIS IMPORT

const DLQ_FILE = 'migration_dlq.json';

// Instantiate old compression logic - Keep this, it's specific to migration
const oldCompression = new DatabaseCompression();

// Removed Database client creation - it will be passed in
// const db: DatabaseClient = createDatabaseClient();

// Removed direct FirebaseClient instantiation logic - Get it from the passed-in client if needed for specific methods


// Define interfaces for old data formats expected from RTDB import
interface OldPostMetadata {
    title?: string;
    authorId?: string; // Changed from author to authorId based on logs
    createdAt?: string;
}

// Structure expected within the decompressed 'storyTree' string
interface OldPostTree {
    // id: string; // ID seems to be the key, not in the value
    text: string; // Changed from storyText to text based on logs
    parentStoryId: string | null; // Renamed from 'parentId' - ASSUMPTION: This was likely the ROOT post ID for all nodes in the tree
    metadata: OldPostMetadata;
    // Potentially replies or other nested data - ASSUMPTION: Replies were NOT stored here based on the old model description lack
}

// Define ReplyData structure inline if not available in types/index.js
// Based on backend_architecture.md
interface ReplyData {
  id: string;
  authorId: string;
  // authorUsername?: string;
  text: string;
  parentId: string;
  parentType: "post" | "reply";
  rootPostId: string;
  quote: {
      text: string;
      sourceId: string;
      selectionRange: {
          start: number;
          end: number;
      };
  };
  createdAt: string; // ISO 8601 Timestamp String
}

interface ValidationError {
    id: string;
    type: 'post' | 'reply' | 'feed' | 'index' | 'unknown';
    error: string;
    data?: any; // Store the problematic data if possible
    key?: string; // Store the key where the error occurred
}

// --- New Validation Helpers ---

// Check if an object conforms to the new Post structure
function isValidNewPost(obj: any): obj is Post {
    if (!obj) {
        logger.warn('isValidNewPost: Validation failed - object is null or undefined.');
        return false;
    }
    if (!(typeof obj.id === 'string' && obj.id.length > 0)) {
        logger.warn(`isValidNewPost: Validation failed - id is not a non-empty string. Received: ${obj.id}`);
        return false;
    }
    if (!(typeof obj.content === 'string' && obj.content.length > 0)) {
        logger.warn(`isValidNewPost: Validation failed - content is not a non-empty string. Received: ${obj.content}`);
        return false;
    }
    // parentId removed from Post type, only exists in ReplyData
    if (!(typeof obj.authorId === 'string' && obj.authorId.length > 0)) {
        logger.warn(`isValidNewPost: Validation failed - authorId is not a non-empty string. Received: ${obj.authorId}`);
        return false;
    }
    if (!(typeof obj.createdAt === 'string' && obj.createdAt.length > 0)) { // Add ISO check later if needed
        logger.warn(`isValidNewPost: Validation failed - createdAt is not a non-empty string. Received: ${obj.createdAt}`);
        return false;
    }
    if (!(typeof obj.replyCount === 'number' && obj.replyCount >= 0)) { // Added replyCount check
        logger.warn(`isValidNewPost: Validation failed - replyCount is not a non-negative number. Received: ${obj.replyCount}`);
        return false;
    }
    return true;
}

// Check if an object conforms to the new ReplyData structure
// NOTE: This is a basic check. More thorough validation (e.g., parent existence) is hard in rules/migration.
function isValidNewReply(obj: any): obj is ReplyData {
    return (
        obj &&
        typeof obj.id === 'string' && obj.id.length > 0 &&
        typeof obj.authorId === 'string' && obj.authorId.length > 0 &&
        typeof obj.text === 'string' && obj.text.length > 0 &&
        typeof obj.parentId === 'string' && obj.parentId.length > 0 &&
        typeof obj.parentType === 'string' && (obj.parentType === 'post' || obj.parentType === 'reply') &&
        typeof obj.rootPostId === 'string' && obj.rootPostId.length > 0 &&
        obj.quote && typeof obj.quote === 'object' &&
        typeof obj.quote.text === 'string' &&
        typeof obj.quote.sourceId === 'string' &&
        obj.quote.selectionRange && typeof obj.quote.selectionRange === 'object' &&
        typeof obj.quote.selectionRange.start === 'number' &&
        typeof obj.quote.selectionRange.end === 'number' &&
        typeof obj.createdAt === 'string' && obj.createdAt.length > 0 // Add ISO check later if needed
    );
}

// Check if an object conforms to the new FeedItem structure
function isValidNewFeedItem(obj: any): obj is FeedItem {
    // Based on the new model: { id, authorId, textSnippet, createdAt }
    return (
        obj &&
        typeof obj.id === 'string' && obj.id.length > 0 && // Refers to Post ID
        typeof obj.authorId === 'string' && obj.authorId.length > 0 &&
        typeof obj.textSnippet === 'string' && // Snippet, not full text
        typeof obj.createdAt === 'string' && obj.createdAt.length > 0 // Add ISO check later if needed
        // Optional authorUsername check if added
    );
}

// --- Data Fetching Helpers ---

// Get post IDs from the *OLD* list created by import_rtdb.ts
// This list *might* have been stored differently than the new 'allPostTreeIds' set.
// ASSUMPTION: The import script stored post IDs under a simple list key 'imported_post_ids' using lPush.
async function getImportedPostIds(dbClient: DatabaseClient, firebaseClientInstance: FirebaseClient): Promise<string[]> {
    // const oldListKey = 'imported_post_ids'; // REMOVE THIS - No longer looking for this predefined list
    logger.info(`Attempting to discover post IDs directly from the database root (for manual import scenario)...`);
    try {
        const rootData = await firebaseClientInstance.readPath('/'); 

        if (!rootData || typeof rootData !== 'object') {
            logger.warn(`No data found at the database root, or it's not an object. Cannot discover post IDs.`);
            return [];
        }

        const discoveredPostIds = Object.keys(rootData).filter(key => {
            const knownNonPostPrefixes = ['user:', 'email_to_id:'];
            const knownExactNonPostKeys = ['users', 'user_ids', 'feedItems', 'allStoryTreeIds', 'imported_post_ids', 'postMetadata', 'replyMetadata', 'userMetadata', 'indexes', 'feedStats'];

            if (knownExactNonPostKeys.includes(key) || knownNonPostPrefixes.some(prefix => key.startsWith(prefix))) {
                logger.debug(`Key '${key}' at root is a known non-post key/prefix. Filtering out.`);
                return false;
            }
            
            if (rootData[key] && typeof rootData[key] === 'object' && rootData[key].hasOwnProperty('storyTree')) {
                logger.debug(`Key '${key}' at root appears to be a post (has storyTree). Including.`);
                return true;
            }
            logger.debug(`Key '${key}' at root does not appear to be a post (missing storyTree or not an object type). Filtering out.`);
            return false;
        });

        if (discoveredPostIds.length === 0) {
            logger.warn(`No potential post IDs discovered at the database root that contain a 'storyTree' and are not known non-post keys.`);
            return [];
        }
        
        logger.info(`Discovered ${discoveredPostIds.length} potential post IDs from database root.`);
        return discoveredPostIds;

    } catch (error) {
        logger.error(`Error discovering post IDs from database root:`, error);
        return [];
    }
}

// --- Migration Steps ---

// REMOVED: migratePostsOnly function - incorporated into migrateAllData
// REMOVED: rebuildPostIndexes function - incorporated into migrateAllData
// REMOVED: rebuildFeed function - incorporated into migrateAllData

async function clearOldDataBeforeMigration(dbClient: DatabaseClient, firebaseClientInstance: FirebaseClient): Promise<void> {
    logger.info("Clearing potentially conflicting OLD data and indexes (best effort)...");
    const pathsToClear = [
        'replies',
        'replyMetadata',
        'indexes/repliesFeedByTimestamp',
        'indexes/repliesByParentQuoteTimestamp',
        'indexes/repliesByRootPostTimestamp',
        'feedItems',
        'feedStats'
    ];
    let clearedCount = 0;
    for (const path of pathsToClear) {
        try {
            logger.info(`Attempting to clear potential old data at path: ${path}`);
            await firebaseClientInstance.removePath(path);
            logger.info(`Successfully cleared path: ${path}`);
            clearedCount++;
        } catch (error) {
            logger.warn({ err: error, path }, `Failed to clear old data path: ${path}. This might be okay if it didn't exist.`);
        }
    }
    logger.info(`Finished clearing potentially conflicting old paths. Cleared ${clearedCount} top-level nodes/indexes.`);
}

// Migration V2: Reads old data, transforms, writes to *new* locations based on backend_architecture.md
async function migrateAllData(dbClient: DatabaseClient, postIds: string[], firebaseClientInstance: FirebaseClient): Promise<{ migratedPosts: Post[], migratedReplies: ReplyData[] }> {
    logger.info(`Starting V2 migration for ${postIds.length} potential posts.`);
    const migratedPosts: Post[] = [];
    const migratedReplies: ReplyData[] = []; // Replies were not migrated before
    let successPostCount = 0;
    let failPostCount = 0;
    // Add counters for replies if we find any (unlikely from old model?)

    // The only use is `oldCompression.decompress`, which is standalone.
    // We use the main `dbClient` for all writes to the new structure.

    for (const postId of postIds) {
        try {
            logger.debug(`Processing potential post ID: ${postId}`);

            // --- Step 1: Read OLD Data ---
            // ASSUMPTION: Old data for a post `postId` was stored with fields like 'storyTree'
            // We need to fetch the OLD data using a method that allows decompression.
            // We can't use dbClient.hGet directly as it won't know to decompress.
            // We must read the *raw* value and decompress manually.

            // Use firebaseClientInstance.readPath to get the raw data at the old key
            const oldPostRootData = await firebaseClientInstance.readPath(postId);
            if (!oldPostRootData || typeof oldPostRootData !== 'object' || !oldPostRootData.storyTree) {
                 logger.warn(`No valid old data or storyTree field found for imported post ID ${postId} at root key. Skipping.`);
                 failPostCount++;
                 continue;
            }
            const compressedStoryTree = oldPostRootData.storyTree; // Get the compressed value

            if (!compressedStoryTree || typeof compressedStoryTree !== 'string') {
                logger.warn(`No valid storyTree string found in old data for post ID ${postId}. Skipping.`);
                failPostCount++;
                continue;
            }

            // --- Step 2: Decompress using old logic ---
            let oldPostData: OldPostTree;
            try {
                const decompressedJson = await oldCompression.decompress<string>(compressedStoryTree);
                oldPostData = JSON.parse(decompressedJson);
                logger.debug(`Decompressed and parsed storyTree for ${postId}`);
            } catch (err) {
                logger.error(`Failed to decompress or parse storyTree for ${postId}:`, err);
                failPostCount++;
                continue;
            }

            logger.debug(`OldPostData: ${JSON.stringify(oldPostData)}`);

            // --- Step 3: Transform OldPostTree -> New Post format ---
            let content = oldPostData.text; // Use oldPostData.text based on logs
            if (oldPostData.metadata?.title) {
                content = `# ${oldPostData.metadata.title}\n\n${content}`; // Markdown title
            }

            const newPost: Post = {
                id: postId, // Use the postId variable from the loop
                content: content, // Default content to empty string if falsy
                authorId: oldPostData.metadata?.authorId || '', // Use metadata.authorId and fallback
                createdAt: oldPostData.metadata?.createdAt || new Date().toISOString(), // Default if missing
                replyCount: 0 // Initialize reply count to 0
            };

            // Validate the transformed post data
            if (!isValidNewPost(newPost)) {
                logger.error(`Transformed post ${JSON.stringify(newPost)} is invalid according to new schema. Skipping write.`, { invalidData: newPost }); // Log the invalid data object
                failPostCount++;
                continue;
            }

            // --- Step 4: Write New Post to the CORRECT new path ---
            // Path: /posts/$postId
            const newPostPath = `posts/${postId}`;
            await dbClient.set(newPostPath, newPost); // Use set on the direct path
            logger.info(`Successfully wrote migrated post ${postId} to new path ${newPostPath}`);
            migratedPosts.push(newPost);
            successPostCount++;

            // --- Step 5: Write New Post Metadata / Indexes ---
            // a) Add to /userMetadata/userIds/$authorId = true (Idempotent)
            await dbClient.sAdd(`userIds:${newPost.authorId}`, newPost.authorId); // sAdd handles path mapping now

            // b) Add to /userMetadata/userPosts/$authorId/$postId = true
            await dbClient.sAdd(`userPosts:${newPost.authorId}`, newPost.id); // sAdd handles path mapping

            // c) Add to /postMetadata/allPostTreeIds/$postId = true
            await dbClient.sAdd(`allPostTreeIds:all`, newPost.id); // Use dummy parentId 'all'

            // d) Add Feed Item to /feedItems (using push key)
            const feedItem: FeedItem = {
                id: newPost.id,
                authorId: newPost.authorId,
                textSnippet: (newPost.content || '').substring(0, 100), // Create snippet
                createdAt: newPost.createdAt,
                // No authorUsername unless denormalized
            };
            await dbClient.lPush('feedItems', feedItem); // lPush uses push() on 'feedItems' path

            // e) Increment Feed Counter /feedStats/itemCount
            await dbClient.incrementFeedCounter(1);

            logger.debug(`Updated metadata and feed for post ${postId}.`);

            // --- Step 6: Delete the OLD root key ---
            // The old data was at the root path `postId`
            await firebaseClientInstance.removePath(postId); // Use direct path removal
            logger.info(`Deleted old post data at root key ${postId}.`);


        } catch (error) {
            logger.error(`Failed to migrate post ${postId}:`, error);
            failPostCount++;
        }
    }
    logger.info(`Post migration finished. Success: ${successPostCount}, Failed: ${failPostCount}`);

    // Since the old model likely didn't store replies separately, we assume migratedReplies is empty.
    // If replies *were* somehow in the old 'storyTree', complex extraction logic would be needed here.
    logger.warn("Migration V2 assumes replies were not stored in the old 'storyTree' format and does not migrate any replies.");

    return { migratedPosts, migratedReplies };
}


// --- Validation Function ---
async function validateMigration(dbClient: DatabaseClient, firebaseClientInstance: FirebaseClient, migratedPosts: Post[]): Promise<ValidationError[]> {
    logger.info('Starting migration V2 validation...');
    const errors: ValidationError[] = [];
    const processedPostIds = new Set<string>(); // Track validated IDs

    // Ensure firebaseClientInstance is valid before use
    if (!firebaseClientInstance) {
        logger.error("Cannot validate migration, FirebaseClient instance not provided.");
        errors.push({ id: 'validation_setup', type: 'unknown', error: 'FirebaseClient instance missing.' });
        return errors;
    }

    // 1. Validate Migrated Posts stored at new locations
    logger.info(`Validating ${migratedPosts.length} migrated posts...`);
    for (const expectedPost of migratedPosts) {
        const postId = expectedPost.id;
        if (processedPostIds.has(postId)) continue;
        processedPostIds.add(postId);

        const postPath = `posts/${postId}`; // New path
        try {
            const postData = await firebaseClientInstance.readPath(postPath); // Read from direct path

            if (!postData) {
                errors.push({ id: postId, type: 'post', error: 'Migrated post data not found at new path.', key: postPath });
            } else if (!isValidNewPost(postData)) {
                errors.push({ id: postId, type: 'post', error: 'Invalid Post structure at new path.', data: postData, key: postPath });
            } else {
                // Optional: Compare fields if needed (e.g., content, authorId)
                // if (postData.content !== expectedPost.content) { ... }
            }
        } catch (err: any) {
            errors.push({ id: postId, type: 'post', error: `Error reading/validating migrated post: ${err.message}`, key: postPath });
        }
    }

    // 2. Validate Post Metadata / Indexes
    logger.info("Validating Post Metadata/Indexes...");
    // a) /userMetadata/userIds
    // b) /userMetadata/userPosts
    // c) /postMetadata/allPostTreeIds
    // These are sets (maps with true values). Check presence for each migrated post.
    for (const post of migratedPosts) {
        // Check userIds
        const userIdPath = `userMetadata/userIds/${post.authorId}`;
        try {
            const exists = await firebaseClientInstance.readPath(userIdPath);
            if (exists !== true) {
                errors.push({ id: post.authorId, type: 'index', error: `User ID not found in userIds set`, key: userIdPath });
            }
        } catch (err: any) { errors.push({ id: post.authorId, type: 'index', error: `Error checking ${userIdPath}: ${err.message}`, key: userIdPath }); }

        // Check userPosts
        const userPostPath = `userMetadata/userPosts/${post.authorId}/${post.id}`;
         try {
            const exists = await firebaseClientInstance.readPath(userPostPath);
            if (exists !== true) {
                errors.push({ id: post.id, type: 'index', error: `Post ID not found in userPosts set for author ${post.authorId}`, key: userPostPath });
            }
        } catch (err: any) { errors.push({ id: post.id, type: 'index', error: `Error checking ${userPostPath}: ${err.message}`, key: userPostPath }); }

        // Check allPostTreeIds
        const allPostsPath = `postMetadata/allPostTreeIds/${post.id}`;
         try {
            const exists = await firebaseClientInstance.readPath(allPostsPath);
            if (exists !== true) {
                errors.push({ id: post.id, type: 'index', error: `Post ID not found in allPostTreeIds set`, key: allPostsPath });
            }
        } catch (err: any) { errors.push({ id: post.id, type: 'index', error: `Error checking ${allPostsPath}: ${err.message}`, key: allPostsPath }); }
    }


    // 3. Validate Feed Items and Counter
    logger.info("Validating Feed Items and Counter...");
    const feedItemsPath = 'feedItems'; // Fixed path
    const feedCounterPath = 'feedStats/itemCount'; // Fixed path
    let validatedFeedCount = 0;
    try {
        let feedItemsData: Record<string, any> | null = await firebaseClientInstance.readPath(feedItemsPath);

        if (feedItemsData) {
            const items = Object.values(feedItemsData);
            logger.info(`Found ${items.length} feed items at path '${feedItemsPath}'. Validating...`);
            const feedItemIds = new Set<string>();
            for (const item of items) {
                if (!isValidNewFeedItem(item)) {
                    errors.push({ id: item?.id || 'unknown', type: 'feed', error: 'Invalid FeedItem structure.', data: item, key: feedItemsPath });
                } else {
                    // Check if the feed item corresponds to a migrated post
                    if (!migratedPosts.some(p => p.id === item.id)) {
                         errors.push({ id: item.id, type: 'feed', error: 'Feed item references a post not in the migrated set.', data: item, key: feedItemsPath });
                    }
                    if (feedItemIds.has(item.id)) {
                         errors.push({ id: item.id, type: 'feed', error: 'Duplicate Post ID found in feed items.', data: item, key: feedItemsPath });
                    }
                    feedItemIds.add(item.id);
                    validatedFeedCount++;
                }
            }
            // Ensure all migrated posts are in the feed
            for (const post of migratedPosts) {
                if (!feedItemIds.has(post.id)) {
                    errors.push({ id: post.id, type: 'feed', error: 'Migrated post missing from feed items.', key: feedItemsPath });
                }
            }

        } else {
            validatedFeedCount = 0; // No items found
            logger.info(`No feed items found at path '${feedItemsPath}'. Checking if migrated posts count is also 0.`);
            if (migratedPosts.length > 0) {
                 errors.push({ id: feedItemsPath, type: 'feed', error: 'No feed items found, but posts were migrated.', key: feedItemsPath });
            }
        }

        // Validate counter
        let counterValue: number | null = await firebaseClientInstance.readPath(feedCounterPath);
        const expectedCount = migratedPosts.length; // Counter should match number of migrated posts

        if (typeof counterValue !== 'number') {
            // If no posts were migrated, counter should be 0 or null (preferably 0)
            if (expectedCount === 0 && counterValue === null) {
                logger.info("Feed counter is null, which is acceptable as 0 posts were migrated.");
            } else {
                errors.push({ id: feedCounterPath, type: 'feed', error: `Feed counter is not a number or missing. Expected ${expectedCount}, Found: ${counterValue}`, key: feedCounterPath });
            }
        } else if (counterValue !== expectedCount) {
            errors.push({ id: feedCounterPath, type: 'feed', error: `Feed counter (${counterValue}) does not match migrated post count (${expectedCount}).`, key: feedCounterPath });
        }

    } catch (error: any) {
        logger.error("Error validating feed items/counter:", error);
        errors.push({ id: feedItemsPath, type: 'feed', error: `Failed to read feed items/counter: ${error.message}` });
    }

    // 4. Validate Absence of Old Root Post Data
    logger.info("Validating absence of old root post data...");
    for (const post of migratedPosts) {
        const oldPostPath = post.id; // Old data was at the root key
        try {
            const oldData = await firebaseClientInstance.readPath(oldPostPath);
            if (oldData !== null) { // Should be null after deletion
                errors.push({ id: post.id, type: 'post', error: 'Old post data still exists at root key.', key: oldPostPath, data: oldData });
            }
        } catch (err: any) {
            errors.push({ id: post.id, type: 'post', error: `Error checking for old post data at ${oldPostPath}: ${err.message}`, key: oldPostPath });
        }
    }

    // 5. Validate Absence of Old Reply Data (by checking new paths are empty)
    logger.info("Validating absence of reply data (new paths should be empty)...");
    const replyPathsToCheck = ['replies', 'replyMetadata', 'indexes/repliesFeedByTimestamp', 'indexes/repliesByParentQuoteTimestamp'];
    for (const path of replyPathsToCheck) {
        try {
             const data = await firebaseClientInstance.readPath(path);
             if (data !== null && (typeof data !== 'object' || Object.keys(data).length > 0)) {
                  errors.push({ id: path, type: 'reply', error: 'Reply-related path is not empty after migration/clearing.', key: path, data: data });
             }
        } catch (err: any) {
            errors.push({ id: path, type: 'reply', error: `Error checking reply path ${path}: ${err.message}`, key: path });
        }
    }

    logger.info(`Validation finished. Found ${errors.length} errors.`);
    return errors;
}


// Main migration function - Now exported and accepts db client
export async function migrate(dbClient: DatabaseClient): Promise<void> { 
    logger.info('Starting data migration function V2...');
    let firebaseClientInstance: FirebaseClient;

    try {
        if (dbClient instanceof FirebaseClient) {
            firebaseClientInstance = dbClient;
        } else if (dbClient instanceof LoggedDatabaseClient) { 
            const underlying = (dbClient as LoggedDatabaseClient).getUnderlyingClient(); 
            if (underlying instanceof FirebaseClient) {
                firebaseClientInstance = underlying;
            } else {
                logger.error("Migration: LoggedDatabaseClient wraps an unexpected client type. Aborting.");
                throw new Error("LoggedDatabaseClient does not wrap a FirebaseClient.");
            }
        } else {
            logger.error("Migration: Could not obtain a raw FirebaseClient instance from the provided dbClient. Aborting.");
            throw new Error("Migration requires a FirebaseClient instance for direct path operations.");
        }
        logger.info("Obtained FirebaseClient instance for migration-specific operations.");

        // --- Attempt to set initial database version ---
        try {
            await dbClient.set('databaseVersion', { current: "1->2", migrationComplete: false });
            logger.info("Initial databaseVersion set to: { current: '1->2', migrationComplete: false }");
        } catch (dbVersionError: any) {
            logger.error({ err: dbVersionError }, "Failed to set initial databaseVersion. This could make tracking migration status difficult.");
            // Optional: throw new Error("Failed to set initial database version, aborting migration.");
        }
        // --- End Attempt to set initial database version ---

        await dbClient.connect().catch(err => {
            logger.error("Migration: Initial DB connection failed.", err);
            throw err; 
        });
        logger.info("Database client assumed connected for migration.");

        // Clear old data first
        await clearOldDataBeforeMigration(dbClient, firebaseClientInstance);

        const postIdsToMigrate = await getImportedPostIds(dbClient, firebaseClientInstance);

        if (!postIdsToMigrate || postIdsToMigrate.length === 0) {
            logger.warn("Migration V2: No post IDs found to migrate (either from old list or by discovery). Skipping further migration steps.");
            logger.info('Migration function V2 finished.');
            return; 
        }

        const { migratedPosts } = await migrateAllData(dbClient, postIdsToMigrate, firebaseClientInstance);

        if (migratedPosts.length === 0 && postIdsToMigrate.length > 0) {
            logger.error("Migration V2 attempted but resulted in zero successfully migrated posts. Check logs for details.");
            throw new Error("Post migration phase failed.");
        }

        logger.info('-----------------------------------');
        logger.info('Core Migration V2 Steps Completed.');
        logger.info('-----------------------------------');

        logger.info('Starting Final Validation (V2)...');
        const validationErrors = await validateMigration(dbClient, firebaseClientInstance, migratedPosts);

        if (validationErrors.length > 0) {
            logger.error(`Migration V2 finished with ${validationErrors.length} validation errors. Check ${DLQ_FILE}.`);
            throw new Error(`Migration V2 completed with ${validationErrors.length} validation errors.`);
        } else {
            logger.info('Migration V2 completed and validated successfully!');
        }

        // If we reach here, all preceding steps in the try block were successful (or involved no data to migrate)
        // --- Set final database version on overall successful completion ---
        try {
            await dbClient.set('databaseVersion', { current: "2", migrationComplete: true });
            logger.info("DatabaseVersion updated on successful script completion to: { current: '2', migrationComplete: true }");
        } catch (dbVersionError: any) {
            logger.error({ err: dbVersionError }, "CRITICAL: Migration script completed successfully, but FAILED to set final databaseVersion status. Manual check required.");
            // Depending on policy, could throw an error to make it explicit.
        }
        // --- End Set final database version on overall successful completion ---

    } catch (err: any) {
        logger.error('Migration script V2 encountered a fatal error:', err);
        // On any error caught by this block, databaseVersion should remain
        // { current: "1->2", migrationComplete: false } due to the initial set.
        throw err;
    } finally {
        logger.info("Migration function V2 finished executing."); // Adjusted log for clarity
    }
}