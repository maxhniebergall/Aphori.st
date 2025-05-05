import * as dotenv from 'dotenv';
// dotenv.config(); // Removed: Handled by server.ts

// import { createDatabaseClient } from './db/index.js'; // Don't need this here
import logger from './logger.js';
// import { Post, Reply, Quote, FeedItem, DatabaseClient } from '../types/index.js'; // Use Interface below
import { Post, FeedItem, DatabaseClient } from './types/index.js'; // Keep specific types
import { DatabaseCompression } from './db/DatabaseCompression.js'; // Needed for old data
import { FirebaseClient } from './db/FirebaseClient.js'; // Needed for hashing/escaping logic
import * as fs from 'fs';
import * as path from 'path';

const DLQ_FILE = 'migration_dlq.json';

// Instantiate old compression logic - Keep this, it's specific to migration
const oldCompression = new DatabaseCompression();

// Removed Database client creation - it will be passed in
// const db: DatabaseClient = createDatabaseClient();

// Removed direct FirebaseClient instantiation logic - Get it from the passed-in client
// let firebaseClientInstance: FirebaseClient;
// ... (old logic removed)

// Define interfaces for old data formats expected from RTDB import
interface OldPostMetadata {
    title?: string;
    author?: string; // Assuming author ID was stored here
    createdAt?: string;
}

// Structure expected within the decompressed 'storyTree' string
interface OldPostTree {
    // id: string; // ID seems to be the key, not in the value
    storyText: string; // Content was likely here - Renamed from 'text'
    parentStoryId: string | null; // Renamed from 'parentId'
    authorId: string; // Added top-level authorId
    metadata: OldPostMetadata;
    // Potentially replies or other nested data
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
    return (
        obj &&
        typeof obj.id === 'string' &&
        typeof obj.content === 'string' &&
        (obj.parentId === null || typeof obj.parentId === 'string') && // Allow string parentId too if needed, though root posts are null
        typeof obj.authorId === 'string' &&
        typeof obj.createdAt === 'string'
    );
}

// Check if an object conforms to the new FeedItem structure
function isValidNewFeedItem(obj: any): obj is FeedItem {
    return (
        obj &&
        typeof obj.id === 'string' &&
        typeof obj.text === 'string' &&
        typeof obj.authorId === 'string' &&
        typeof obj.createdAt === 'string'
    );
}

// --- Data Fetching Helpers ---

// Get post IDs from the list created by import_rtdb.ts
async function getImportedPostIds(dbClient: DatabaseClient): Promise<string[]> {
    logger.info("Fetching imported post IDs from 'allPostTreeIds' list using getAllListItems...");
    try {
        // The import script used lPush, storing under the hashed key 'allPostTreeIds'
        // Use the new getAllListItems method
        // The method should exist on the client now via the interface and wrappers.
        const postIds = await dbClient.getAllListItems('allPostTreeIds'); // This should return the actual IDs

        // The values returned by getAllListItems should be the post IDs themselves.
        if (!Array.isArray(postIds)) {
             logger.warn("Fetched 'allPostTreeIds' using getAllListItems but it wasn't an array:", postIds);
             return [];
        }
        // Ensure all elements are strings
        const stringIds = postIds.filter(id => typeof id === 'string');
        if (stringIds.length !== postIds.length) {
            logger.warn("Some elements returned by getAllListItems for 'allPostTreeIds' were not strings.");
        }
        logger.info(`Found ${stringIds.length} imported post IDs.`);
        return stringIds as string[];
    } catch (error) {
        logger.error("Error fetching 'allPostTreeIds' using getAllListItems:", error);
        // If the list doesn't exist, return empty array
        // Check error type more carefully if possible
        if (error instanceof Error) { // Basic check
            logger.warn("getAllListItems failed, assuming 'allPostTreeIds' list not found or empty.");
            return [];
        }
        throw error; // Re-throw other errors
    }
}

// --- Migration Steps ---

    async function migratePostsOnly(dbClient: DatabaseClient, postIds: string[], firebaseClientInstance: FirebaseClient): Promise<Post[]> {
    logger.info(`Starting migration for ${postIds.length} posts.`);
    const migratedPosts: Post[] = [];
    let successCount = 0;
    let failCount = 0;

    // --- Get the CompressedDatabaseClient layer if possible ---
    let compressedClient: any = null;
    if ((dbClient as any).underlyingClient && typeof (dbClient as any).underlyingClient.getCompression === 'function') {
        compressedClient = (dbClient as any).underlyingClient;
        logger.info("Migration: Found CompressedDatabaseClient via .underlyingClient");
    } else if (typeof (dbClient as any).getCompression === 'function') {
         compressedClient = dbClient;
         logger.info("Migration: dbClient itself appears to be CompressedDatabaseClient");
    }
    if (!compressedClient) {
        throw new Error("Migration failed: Could not obtain CompressedDatabaseClient instance to read raw data.");
    }
    // --- End Compressed Client retrieval ---

    for (const postId of postIds) {
        try {
            logger.debug(`Processing post ID: ${postId}`);
            // 1. Read the imported 'storyTree' string using the compressed client
            const compressedStoryTree = await compressedClient.hGet(postId, 'storyTree', { returnCompressed: true });

            if (!compressedStoryTree || typeof compressedStoryTree !== 'string') {
                logger.warn(`No valid storyTree string found for imported post ID ${postId}. Skipping.`);
                failCount++;
                continue;
            }

            // 2. Decompress using old logic
            let oldPostData: OldPostTree;
            try {
                const decompressedJson = await oldCompression.decompress<string>(compressedStoryTree);
                oldPostData = JSON.parse(decompressedJson);
                logger.debug(`Decompressed and parsed storyTree for ${postId}`);
            } catch (err) {
                logger.error(`Failed to decompress or parse storyTree for ${postId}:`, err);
                failCount++;
                continue;
            }

            // 3. Transform OldPostTree -> New Post format
            let content = oldPostData.storyText; // Use storyText from logs
            if (oldPostData.metadata?.title) {
                content = `# ${oldPostData.metadata.title}\n\n${content}`;
                logger.debug(`Prepended title to content for ${postId}`);
            }

            const newPost: Post = {
                id: postId, // Use the postId variable from the loop
                content: content || '', // Default content to empty string if falsy
                authorId: oldPostData.authorId || 'unknown_author', // Default authorId if falsy
                createdAt: oldPostData.metadata?.createdAt || new Date().toISOString(), // Default if missing
            };

            // Re-add WARN log before validation to see the object structure - Removing now
            // logger.warn({ postId: postId, dataBeingValidated: newPost }, "Attempting to validate transformed post data (WARN level)"); 

            if (!isValidNewPost(newPost)) {
                 logger.error(`Transformed post ${postId} is invalid. Skipping write.`, {invalidData: newPost}); // Log the invalid data object
                 failCount++;
                 continue;
            }

            // 4. Write the new Post object to the new Firebase structure
            // Ensure firebaseClientInstance is valid before use
            if (!firebaseClientInstance) {
                throw new Error("FirebaseClient instance is required for key encoding but was not provided.");
            }
            const newPostKey = firebaseClientInstance.encodeKey(postId, 'post'); // Using internal method, adjust if access changes
            const newFieldKey = 'postTree'; // Storing under a 'postTree' field for consistency with GET route

            // Use hSet from the main db client (Logged -> Firebase)
            // FirebaseClient's hSet expects object, not stringified JSON
            await dbClient.hSet(newPostKey, newFieldKey, newPost); // Store the object directly
            logger.info(`Successfully wrote migrated post ${postId} to new key ${newPostKey}/${newFieldKey}`);

            // 5. Delete the old root key postId containing the storyTree field
            await dbClient.del(postId);
            logger.info(`Deleted old post key ${postId}.`);

            migratedPosts.push(newPost);
            successCount++;

        } catch (error) {
            logger.error(`Failed to migrate post ${postId}:`, error);
            failCount++;
        }
    }
    logger.info(`Post migration finished. Success: ${successCount}, Failed: ${failCount}`);
    return migratedPosts;
}

async function rebuildPostIndexes(dbClient: DatabaseClient, migratedPosts: Post[], firebaseClientInstance: FirebaseClient): Promise<void> {
    logger.info("Rebuilding post indexes...");
    const allPostsIndexKey = 'allPostTreeIds'; // New index key (hashed by client)
    const userPostsPrefix = 'user'; // Prefix for user-specific post sets

    // 1. Clear old indexes (adjust patterns as needed)
    logger.info("Clearing old post indexes (best effort)...");
    try {
        await dbClient.del('allPostTreeIds'); // Delete old root list if it exists
        // Need pattern for old user post sets, e.g., user:*:posts
        // const oldUserPostKeys = await dbClient.keys('user:*:posts'); // `keys` might be slow/unavailable in Firebase
        // for (const key of oldUserPostKeys) { await dbClient.del(key); }
        logger.warn("Skipping deletion of old user:*:posts sets (requires KEYS or known pattern). Manual cleanup might be needed.");
    } catch (error) {
        logger.warn("Error during old index cleanup (might be ok if they don't exist):", error);
    }

    // 2. Rebuild indexes based on migrated posts
    const allPostsUpdates: Record<string, any> = {};
    const userPostsUpdates: Record<string, Record<string, any>> = {}; // { userIndexKey: { escapedPostId: true } }

    // Ensure firebaseClientInstance is valid before use
    if (!firebaseClientInstance) {
        throw new Error("FirebaseClient instance is required for key handling but was not provided.");
    }

    for (const post of migratedPosts) {
        // Add to 'allPostTreeIds' (using escaped ID as key for Firebase Set simulation)
        const escapedPostId = (firebaseClientInstance as any)._escapeFirebaseKey(post.id); // Use internal escape method
        allPostsUpdates[escapedPostId] = true;

        // Add to 'user:<userId>:posts'
        const userIndexKey = firebaseClientInstance.encodeKey(`${userPostsPrefix}:${post.authorId}:posts`); // Use internal encodeKey
        if (!userPostsUpdates[userIndexKey]) {
            userPostsUpdates[userIndexKey] = {};
        }
        userPostsUpdates[userIndexKey][escapedPostId] = true;
    }

    // 3. Write new indexes
    try {
        const allPostsHashedKey = firebaseClientInstance.encodeKey(allPostsIndexKey); // Ensure the base key itself is handled if needed
        if (Object.keys(allPostsUpdates).length > 0) {
            // Using set for the whole object might be better than individual updates for Firebase
            await dbClient.set(allPostsHashedKey, allPostsUpdates);
            logger.info(`Rebuilt '${allPostsHashedKey}' index with ${Object.keys(allPostsUpdates).length} posts.`);
        } else {
            logger.info(`No posts to add to '${allPostsHashedKey}' index.`);
        }

        // Update user-specific post sets
        for (const [userIndexKey, updates] of Object.entries(userPostsUpdates)) {
            // userIndexKey is already encoded/hashed by encodeKey
            if (Object.keys(updates).length > 0) {
                 await dbClient.set(userIndexKey, updates); // Overwrite/create the user's post set
                 logger.info(`Rebuilt user post index '${userIndexKey}' with ${Object.keys(updates).length} posts.`);
            }
        }
    } catch (error) {
        logger.error("Error writing rebuilt post indexes:", error);
        throw error; // Propagate error
    }
    logger.info("Finished rebuilding post indexes.");
}

async function rebuildFeed(dbClient: DatabaseClient, migratedPosts: Post[], firebaseClientInstance: FirebaseClient): Promise<void> {
    logger.info("Rebuilding feed...");

    // 1. Clear existing feed data
    const feedItemsPath = 'feedItems'; // Fixed path, not hashed
    const feedCounterPath = 'feedStats/itemCount'; // Fixed path, not hashed
    logger.info(`Clearing existing feed data at path: ${feedItemsPath}`);
    logger.info(`Clearing existing feed counter at path: ${feedCounterPath}`);
    try {
        // Let's use FirebaseClient's native methods if possible for fixed paths
        if (firebaseClientInstance) {
            // await firebaseClientInstance.getDb().ref(feedItemsPath).remove(); // Direct access -> Replaced with removePath
            await firebaseClientInstance.removePath(feedItemsPath);
            // await firebaseClientInstance.getDb().ref(feedCounterPath).remove(); // Direct access -> Replaced with removePath
            await firebaseClientInstance.removePath(feedCounterPath);
            logger.info("Cleared existing feed items and counter using FirebaseClient.removePath.");
        } else {
             logger.error("Cannot clear feed, FirebaseClient instance not available.");
            return; // Cannot proceed
        }

    } catch (error) {
        logger.error("Error clearing feed data:", error);
        // Decide if we should proceed or abort
        throw error;
    }

    // 2. Add root posts to the feed
    let feedItemCount = 0;
    for (const post of migratedPosts) {
            // logger.debug(`Post ${post.id} identified as root post (parentId='root'). Adding to feed.`); // Removed log

            // Create feed item
            try {
                const feedItem: FeedItem = {
                    id: post.id,
                    text: post.content, // Use the full migrated content
                    authorId: post.authorId,
                    createdAt: post.createdAt,
                };

                // Use the DatabaseClient methods which delegate to FirebaseClient's specific implementations
                // await dbClient.addFeedItem(feedItem); // Should use push() on 'feedItems'
                // logger.debug(`Added post ${post.id} to feedItems.`); // Removed log

                // Increment counter
                try {
                    // logger.info(`Attempting to increment feed counter for post ${post.id}...`); // Removed log
                    await dbClient.incrementFeedCounter(1); // Should use transaction on 'feedStats/itemCount'
                    // logger.info(`Successfully incremented feed counter for post ${post.id}.`); // Removed log
                } catch (err) {
                    logger.error(`Failed to increment feed counter for post ${post.id}:`, err); // Kept error log
                    // Decide if this is fatal or ignorable
                }
                feedItemCount++;
            } catch (error) {
                logger.error(`Failed to add post ${post.id} to feed:`, error);
                // Continue adding other items?
            }
        
    }

    logger.info(`Finished rebuilding feed. Added ${feedItemCount} items.`);
}

async function clearOldReplyData(dbClient: DatabaseClient): Promise<void> {
    logger.info("Clearing ALL old reply data and indexes (as they are not migrated)...");
    // Define patterns for old reply keys/indexes - adjust these based on the *actual* old structure
    const oldReplyPatterns = [
        'reply:*', // Assuming old replies were stored like this
        'replies:uuid:*', // Old index
        'replies:feed:*', // Old index
        '*:quoteCounts', // Old quote counts (matches <parentId>:quoteCounts)
        'user:*:replies', // Old user reply sets
        // Add any other known patterns for old reply-related data
    ];

    let deletedCount = 0;
    for (const pattern of oldReplyPatterns) {
        try {
            // Using KEYS is generally discouraged in production Redis, and might be slow/unsupported in Firebase simulation
            // This is a placeholder - a more robust approach would be needed if KEYS isn't viable
            // For Firebase, scanning/deleting based on prefixes might require different logic
            logger.warn(`Attempting to find keys matching pattern: ${pattern}. This may be slow or incomplete.`);
            const keysToDelete = await dbClient.keys(pattern); // Assumes keys method exists and works
            logger.info(`Found ${keysToDelete.length} keys matching ${pattern}. Deleting...`);
            for (const key of keysToDelete) {
                try {
                    await dbClient.del(key);
                    deletedCount++;
                    logger.debug(`Deleted old key: ${key}`);
                } catch (delError) {
                    logger.error(`Failed to delete old key ${key}:`, delError);
                }
            }
             logger.info(`Finished deleting keys for pattern ${pattern}.`);
        } catch (error) {
            logger.error(`Error finding/deleting keys for pattern ${pattern}:`, error);
             logger.warn(`Could not automatically clear keys for pattern: ${pattern}. Manual cleanup might be required.`);
        }
    }
    logger.info(`Finished clearing old reply data. Attempted deletion of ${deletedCount} keys (check logs for errors).`);
}

// --- Validation Function ---
async function validateMigration(dbClient: DatabaseClient, firebaseClientInstance: FirebaseClient): Promise<ValidationError[]> {
    logger.info('Starting migration validation...');
    const errors: ValidationError[] = [];
    const processedIds = new Set<string>(); // Track validated IDs

    // Ensure firebaseClientInstance is valid before use
    if (!firebaseClientInstance) {
        logger.error("Cannot validate migration, FirebaseClient instance not provided.");
        errors.push({ id: 'validation_setup', type: 'unknown', error: 'FirebaseClient instance missing.' });
        return errors;
    }

    // 1. Validate Posts
    logger.info("Validating Posts...");
    const allPostsIndexKey = firebaseClientInstance.encodeKey('allPostTreeIds'); // Use encoded key
    try {
        const postSet = await dbClient.get(allPostsIndexKey); // Get the whole set object
        if (postSet && typeof postSet === 'object') {
             const escapedPostIds = Object.keys(postSet);
             logger.info(`Found ${escapedPostIds.length} posts in the new index '${allPostsIndexKey}'. Validating...`);
             for (const escapedPostId of escapedPostIds) {
                const postId = (firebaseClientInstance as any)._unescapeFirebaseKey(escapedPostId); // Unescape
                if (processedIds.has(postId)) continue;
                processedIds.add(postId);

                const postKey = firebaseClientInstance.encodeKey(postId, 'post');
                const fieldKey = 'postTree';
                try {
                    // Use hGet from dbClient (handles Logged->Firebase)
                    const postData = await dbClient.hGet(postKey, fieldKey); // Should return the object

                    if (!postData) {
                         errors.push({ id: postId, type: 'post', error: 'Post data not found at new key.', key: `${postKey}/${fieldKey}` });
                    } else if (!isValidNewPost(postData)) {
                         errors.push({ id: postId, type: 'post', error: 'Invalid Post structure.', data: postData, key: `${postKey}/${fieldKey}` });
                    }
                } catch (err: any) {
                     errors.push({ id: postId, type: 'post', error: `Error reading/validating post: ${err.message}`, key: `${postKey}/${fieldKey}` });
                }
             }
        } else {
             logger.warn(`Could not find or read post index at ${allPostsIndexKey}`);
             errors.push({ id: allPostsIndexKey, type: 'index', error: 'New post index not found or invalid.' });
        }
    } catch (error: any) {
        logger.error(`Error validating posts using index ${allPostsIndexKey}:`, error);
        errors.push({ id: allPostsIndexKey, type: 'index', error: `Failed to read post index: ${error.message}` });
    }

    // 2. Validate Feed Items
    logger.info("Validating Feed Items...");
    const feedItemsPath = 'feedItems'; // Fixed path
    const feedCounterPath = 'feedStats/itemCount'; // Fixed path
    let validatedFeedCount = 0;
    try {
        // Need a way to get all items from Firebase list (push keys)
        // FirebaseClient doesn't have lRange, use direct access if possible
        let feedItemsData: Record<string, any> | null = null;
        if (firebaseClientInstance) {
            // const snapshot = await firebaseClientInstance.getDb().ref(feedItemsPath).once('value'); // Replaced with readPath
            // feedItemsData = snapshot.val();
            feedItemsData = await firebaseClientInstance.readPath(feedItemsPath);
        } else {
            logger.error("Cannot validate feed, FirebaseClient instance not available.");
            errors.push({ id: feedItemsPath, type: 'feed', error: 'Cannot access FirebaseClient to read feed.' });
        }

        if (feedItemsData) {
            const items = Object.values(feedItemsData);
            logger.info(`Found ${items.length} feed items at path '${feedItemsPath}'. Validating...`);
            for (const item of items) {
                 if (!isValidNewFeedItem(item)) {
                    errors.push({ id: item?.id || 'unknown', type: 'feed', error: 'Invalid FeedItem structure.', data: item, key: feedItemsPath });
                 } else {
                    validatedFeedCount++;
                 }
            }
            // Validate counter
            let counterValue: number | null = null;
             if (firebaseClientInstance) {
                 // const snapshot = await firebaseClientInstance.getDb().ref(feedCounterPath).once('value'); // Replaced with readPath
                 // counterValue = snapshot.val();
                 counterValue = await firebaseClientInstance.readPath(feedCounterPath);
             }
             if (typeof counterValue !== 'number') {
                  errors.push({ id: feedCounterPath, type: 'feed', error: `Feed counter is not a number or missing. Found: ${counterValue}`, key: feedCounterPath });
             } else if (counterValue !== validatedFeedCount) {
                  errors.push({ id: feedCounterPath, type: 'feed', error: `Feed counter (${counterValue}) does not match validated item count (${validatedFeedCount}).`, key: feedCounterPath });
             }

        } else {
            logger.info(`No feed items found at path '${feedItemsPath}'.`);
            // Check if counter is 0
             let counterValue: number | null = null;
              if (firebaseClientInstance) {
                  // const snapshot = await firebaseClientInstance.getDb().ref(feedCounterPath).once('value'); // Replaced with readPath
                  // counterValue = snapshot.val();
                  counterValue = await firebaseClientInstance.readPath(feedCounterPath);
              }
              if (counterValue !== null && counterValue !== 0) {
                   errors.push({ id: feedCounterPath, type: 'feed', error: `Feed counter (${counterValue}) exists but no feed items found.`, key: feedCounterPath });
              }
        }
    } catch (error: any) {
         logger.error("Error validating feed items:", error);
         errors.push({ id: feedItemsPath, type: 'feed', error: `Failed to read feed items: ${error.message}` });
    }

    // 3. Validate Absence of Old Reply Data (optional but recommended)
    logger.info("Validating absence of old reply data (best effort)...");
    // Add checks here to ensure keys matching old reply patterns are gone.
    // This might involve `get` or `keys` calls on patterns like `reply:*`, `*:quoteCounts`, etc.
    // Example check:
    // const sampleOldReplyKey = 'reply:some_known_old_id'; // If you know one
    // try {
    //   const oldData = await dbClient.get(sampleOldReplyKey);
    //   if (oldData) {
    //     errors.push({ id: sampleOldReplyKey, type: 'reply', error: 'Old reply data still exists.', key: sampleOldReplyKey });
    //   }
    // } catch (e) { /* Ignore if key doesn't exist */ }
    logger.warn("Validation for absence of old reply data is not fully implemented. Manual checks recommended.");


    logger.info(`Validation finished. Found ${errors.length} errors.`);
    return errors;
}


// Function to write errors to DLQ file
function writeToDLQ(errors: ValidationError[]): void {
    if (errors.length === 0) {
        logger.info("No validation errors found.");
        // Optionally delete the DLQ file if it exists from a previous run
        try {
            const dlqPath = path.join(process.cwd(), DLQ_FILE);
            if (fs.existsSync(dlqPath)) {
                fs.unlinkSync(dlqPath);
                logger.info(`Removed existing DLQ file: ${DLQ_FILE}`);
            }
        } catch (err) {
            logger.warn(`Could not remove existing DLQ file: ${err}`);
        }
        return;
    }

    const dlqPath = path.join(process.cwd(), DLQ_FILE);
    // Sort errors for consistency
    errors.sort((a, b) => (a.key || a.id).localeCompare(b.key || b.id));
    const dlqContent = JSON.stringify(errors, null, 2);
    fs.writeFileSync(dlqPath, dlqContent);
    logger.error(`Written ${errors.length} validation errors to ${DLQ_FILE}`);
}


// Main migration function - Now exported and accepts db client
export async function migrate(dbClient: DatabaseClient): Promise<void> { // Use interface type
    let exitCode = 0; // Keep track internally, but don't exit process
    let firebaseClientInstance: FirebaseClient | null = null;

    // --- Try to get the underlying FirebaseClient instance ---
    // dbClient is expected to be LoggedDatabaseClient -> CompressedDatabaseClient -> FirebaseClient
    if ((dbClient as any).underlyingClient && (dbClient as any).underlyingClient.db) {
        const potentialFirebaseClient = (dbClient as any).underlyingClient.db;
        if (potentialFirebaseClient instanceof FirebaseClient) {
            firebaseClientInstance = potentialFirebaseClient;
            logger.info("Successfully obtained underlying FirebaseClient instance via .underlyingClient.db for migration.");
        } else {
            logger.error({ clientType: potentialFirebaseClient?.constructor?.name }, "The .underlyingClient.db property did not yield a FirebaseClient instance.");
        }
    } else if ((dbClient as any).underlyingClient && (dbClient as any).underlyingClient instanceof FirebaseClient) {
        // Maybe only one layer of wrapping? (Logged -> Firebase)
        firebaseClientInstance = (dbClient as any).underlyingClient;
        logger.info("Obtained underlying FirebaseClient instance (single wrapper layer) for migration.");
    } else if (dbClient instanceof FirebaseClient) {
        // No wrapping?
        firebaseClientInstance = dbClient;
        logger.info("Provided dbClient is already a FirebaseClient instance.");
    } else {
         logger.error({ 
             clientType: dbClient?.constructor?.name,
             hasUnderlying: !!(dbClient as any).underlyingClient,
             underlyingType: (dbClient as any).underlyingClient?.constructor?.name,
             underlyingHasDb: !!(dbClient as any).underlyingClient?.db,
         }, "Could not determine how to access the underlying FirebaseClient instance from the provided dbClient.");
    }
    // --- Old logic removed ---
    // if ((dbClient as any).getCompression) { ...

    if (!firebaseClientInstance) {
        logger.error("Could not get underlying FirebaseClient instance for migration. Aborting migration logic.");
        // Don't exit, just throw or return to let the server handle it
        throw new Error("Migration failed: Could not obtain FirebaseClient instance.");
        // return;
    }
    // --- End FirebaseClient instance retrieval ---

    try {
        // Removed: await dbClient.connect(); // Assume client is already connected by server.ts
        logger.info('Database client assumed connected for migration.');

        // 1. Get IDs of imported posts
        const postIdsToMigrate = await getImportedPostIds(dbClient);
        if (postIdsToMigrate.length === 0) {
            logger.warn("Migration: No imported post IDs found in 'allPostTreeIds'. Assuming no data to migrate or import failed. Skipping migration steps.");
            // Don't exit, just return cleanly if nothing to migrate
            return;
        }

        // 2. Migrate Posts Only (reading old keys, writing new keys)
        const migratedPosts = await migratePostsOnly(dbClient, postIdsToMigrate, firebaseClientInstance);
        if (migratedPosts.length === 0 && postIdsToMigrate.length > 0) {
             logger.error("Migration attempted but resulted in zero successfully migrated posts. Aborting index/feed rebuild.");
            throw new Error("Post migration failed.");
        }

        // 3. Rebuild Post Indexes
        await rebuildPostIndexes(dbClient, migratedPosts, firebaseClientInstance);

        // 4. Rebuild Feed
        await rebuildFeed(dbClient, migratedPosts, firebaseClientInstance);

        // 5. Clear Old Reply Data (Critical Step)
        await clearOldReplyData(dbClient);

        logger.info('-----------------------------------');
        logger.info('Core Migration Steps Completed.');
        logger.info('-----------------------------------');

        // 6. Validate final state
        logger.info('Starting Final Validation...');
        const validationErrors = await validateMigration(dbClient, firebaseClientInstance);
        writeToDLQ(validationErrors);

        if (validationErrors.length > 0) {
            logger.error(`Migration finished with ${validationErrors.length} validation errors. Check ${DLQ_FILE}.`);
            // Don't set exitCode or exit, maybe throw an error?
            throw new Error(`Migration completed with ${validationErrors.length} validation errors.`);
        } else {
            logger.info('Migration completed and validated successfully!');
        }

    } catch (err) {
        logger.error('Migration script encountered a fatal error:', err);
        // Don't set exit code, re-throw the error for server.ts to handle
        throw err;
    } finally {
        logger.info("Migration function finished.");
        // Removed: Disconnect logic - handled by server.ts
        // Removed: process.exit()
    }
}

// Removed: Standalone execution call
// logger.info("===================================");
// ...
// migrate(db);