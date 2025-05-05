import fs from 'fs/promises'; // Use promises for async file reading
import * as fsSync from 'fs'; // Import sync fs for existsSync
import path from 'path';
import { DatabaseClientInterface } from './db/DatabaseClientInterface.js'; // Uncommented
import logger from './logger.js'; // Uncommented
import { DatabaseClient } from './types';

// Define structures for better clarity, though the main loop will use checks
interface StoryEntry {
    storyTree: string;
}

interface Base64EncodedEntry {
    v: number;
    c: boolean;
    d: string; // Base64 encoded JSON string for email_to_id
}

interface UserDataEntry {
    data: string; // JSON string containing user details
}

interface UserIdsObject {
    [userId: string]: true;
}

type FeedItemsArray = string[]; // Array of JSON strings

interface AllStoryTreeIdsEntry {
     d: string; // JSON string representing an array of IDs
}


// More generic type for the parsed JSON root
interface RtdbExport {
    [key: string]: StoryEntry | Base64EncodedEntry | UserDataEntry | UserIdsObject | FeedItemsArray | AllStoryTreeIdsEntry | any; // Allow flexibility
}

/**
 * Imports data from a Firebase Realtime Database export JSON file into Redis.
 * Handles various data structures present in the export.
 * @param jsonFilePath The path to the RTDB export JSON file.
 * @throws {Error} If file reading, JSON parsing, or database operations fail.
 */
async function importRtdbData(jsonFilePath: string, db: DatabaseClient ): Promise<void> {
    logger.info("Entered importRtdbData function.");
    try {
        logger.info(`Starting RTDB data import from: ${jsonFilePath}`);

        // 1. Initialize and connect DB client
        await db.connect(); // Use the actual client now
        logger.info("Database client connected for import.");

        // 2. Read JSON file
        const fileContent = await fs.readFile(jsonFilePath, 'utf-8');
        logger.info(`Successfully read file: ${jsonFilePath}`);

        // 3. Parse JSON
        const data: RtdbExport = JSON.parse(fileContent);
        logger.info(`Successfully parsed JSON data. Found ${Object.keys(data).length} top-level entries.`);

        // 4. Iterate and insert data based on key patterns
        let processedCount = 0;
        let storyCount = 0;
        let emailIdCount = 0;
        let userCount = 0;
        let errorCount = 0;

        for (const [key, value] of Object.entries(data)) {
            try {
                processedCount++;
                if (key === 'allStoryTreeIds' && typeof value?.d === 'string') {
                    // Handle allStoryTreeIds array
                    const ids: string[] = JSON.parse(value.d);
                    await db.del('allPostTreeIds'); // Clear existing list
                    if (ids.length > 0) {
                        // LPUSH adds elements to the beginning of the list.
                        // If the original order matters and was tail-appended, use RPUSH.
                        // Assuming LPUSH is consistent with seed.ts
                         await db.lPush('allPostTreeIds', ids); // Use actual db client
                         logger.info(`Imported ${ids.length} IDs into 'allPostTreeIds' list.`);
                    } else {
                        logger.info("'allStoryTreeIds' entry found but contained no IDs.");
                    }
                } else if (key === 'user_ids' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    // Handle user_ids object -> Set
                    const userIds = Object.keys(value);
                    await db.del('user_ids'); // Clear existing set
                    if (userIds.length > 0) {
                         // Iterate and add each user ID individually
                         for (const userId of userIds) {
                            await db.sAdd('user_ids', userId); // Use actual db client
                         }
                         logger.info(`Imported ${userIds.length} user IDs into 'user_ids' set.`);
                    } else {
                         logger.info("'user_ids' entry found but contained no user IDs.");
                    }
                } else if (key === 'feedItems' && Array.isArray(value)) {
                     // Handle feedItems array -> List
                     const feedItems = value as FeedItemsArray; // Assume they are strings
                     await db.del('feedItems'); // Clear existing list
                     if (feedItems.length > 0) {
                         // Assuming LPUSH consistency
                         await db.lPush('feedItems', feedItems); // Use actual db client
                         logger.info(`Imported ${feedItems.length} items into 'feedItems' list.`);
                     } else {
                        logger.info("'feedItems' entry found but was empty.");
                     }
                } else if (key.startsWith('email_to_id:') && typeof value?.d === 'string') {
                    // Handle email_to_id:* -> Simple Key/Value
                    // The value 'd' is a base64 encoded JSON string like "\"Admin\""
                    const decodedJsonString = Buffer.from(value.d, 'base64').toString('utf-8');
                    const actualValue = JSON.parse(decodedJsonString); // Parse the JSON string to get the actual value
                    await db.set(key, actualValue); // Use actual db client
                    emailIdCount++;
                } else if (key.startsWith('user:') && typeof value?.data === 'string') {
                    // Handle user:* -> Simple Key/Value (storing the JSON string as value)
                    // The value 'data' field is the JSON string we want to store
                    await db.set(key, value.data); // Use actual db client
                    userCount++;
                } else if (value && typeof value.storyTree === 'string') {
                    // Handle individual story entries (UUIDs or named keys) -> Hash
                    await db.hSet(key, 'storyTree', value.storyTree); // Use actual db client
                    storyCount++;
                } else {
                    logger.warn(`Skipping unrecognized top-level key or invalid format: ${key}`);
                }

                if (processedCount % 100 === 0) {
                    logger.info(`Processed ${processedCount} entries...`);
                }

            } catch (entryError) {
                 logger.error({ err: entryError, key }, `Failed processing entry for key ${key}`);
                 errorCount++;
                 // Decide whether to continue or stop
                 // throw entryError; // Uncomment to stop on first error
            }
        }

        logger.info(`Finished processing entries. Total: ${processedCount}, Stories: ${storyCount}, EmailMappings: ${emailIdCount}, Users: ${userCount}, Errors: ${errorCount}`);
        logger.info("RTDB data import process completed.");

    } catch (error) {
        logger.error('Critical error during RTDB data import:', error);
        throw error; // Re-throw critical errors
    }
}


// Export the function if it needs to be used programmatically elsewhere
export { importRtdbData };
