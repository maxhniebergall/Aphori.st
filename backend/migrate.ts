/*
Migration Script for Unified Node Structure

Requirements:
- Migrate existing postTree and reply records to the new unified node structure
- For postTree records with titles:
  - Prepend the title to the text content with markdown formatting (`# Title\n\nContent`)
  - Remove title field from metadata
- For reply records:
  - Move the 'quote' field into metadata
  - Ensure metadata includes parentId, author, createdAt
- Validate migration:
  - Scan all objects in database
  - Verify they are in new format (Post, Reply)
  - Log non-compliant objects to DLQ file
  - Throw exception if any non-compliant objects found

How to Run:
1. Make sure the backend container and Redis are running
2. Execute the script inside the backend container using:
   ```bash
   docker exec aphorist-backend-1 sh -c 'cd /app && NODE_OPTIONS="--loader ts-node/esm --experimental-specifier-resolution=node" node migrate.ts'
   ```
3. Check the logs for migration progress and any validation errors
4. If validation errors occur, they will be written to migration_dlq.json

Note: The script requires ts-node and ES modules support. Do not try to compile it with tsc directly.

TODO: migration for removal of UnifiedNode, and replacement with Post and Reply
*/

import * as dotenv from 'dotenv';
dotenv.config();

import { createDatabaseClient } from './db/index.js';
import newLogger from './logger.js';
import { Post, Reply, Quote } from './types/index.js';
import { DatabaseClient } from './types/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { RedisClient } from './db/RedisClient.js';

const logger = newLogger('migrate.ts');
const DLQ_FILE = 'migration_dlq.json';

// Create Redis client directly for feed item operations
const redisConfig = {
    url: `redis://${process.env.REDIS_SERVER_IP || 'localhost'}:${process.env.REDIS_PORT || 6379}`
};
const redisClient = new RedisClient(redisConfig);

// Use compressed client for other operations
const db = createDatabaseClient();

// Define interfaces for old data formats
interface OldStoryMetadata {
    title?: string;
    author?: string;
    createdAt?: string;
    quote?: Quote | null;
}

interface OldPostTree {
    id: string;
    text: string;
    parentId: string | null;
    metadata: OldStoryMetadata;
}

interface OldReply {
    id: string;
    text: string;
    parentId: string[];
    metadata: {
        author: string;
        createdAt?: string;
    };
    quote?: Quote;
}

interface OldFeedItem {
    id: string;
    title?: string;
    text: string;
    author: {
        id: string;
        email: string;
    };
    createdAt: string;
}

interface ValidationError {
    id: string;
    type: 'story' | 'reply' | 'feed';
    error: string;
    data: any;
}

// Helper function to validate UnifiedNode structure
function isValidUnifiedNode(node: any): boolean {
    if (!node) return false;
    
    // Check required fields
    if (!node.id || !node.type || !node.content || !node.metadata) {
        return false;
    }
    
    // Check type value
    if (node.type !== 'story' && node.type !== 'reply') {
        return false;
    }
    
    // Check metadata structure
    const metadata = node.metadata;
    if (!metadata.author || !metadata.createdAt) {
        return false;
    }
    
    // Ensure no title field exists
    if ('title' in metadata) {
        return false;
    }
    
    // Check parentId format
    if (metadata.parentId !== null && !Array.isArray(metadata.parentId)) {
        return false;
    }
    
    return true;
}

// Helper function to validate FeedItem structure
function isValidFeedItem(item: any): boolean {
    if (!item) return false;
    
    // Check required fields
    if (!item.id || !item.text || !item.author || !item.createdAt) {
        return false;
    }
    
    // Check author structure
    if (!item.author.id || !item.author.email) {
        return false;
    }
    
    // Ensure no title field exists
    if ('title' in item) {
        return false;
    }
    
    return true;
}

// Validation function
async function validateMigration(db: DatabaseClient): Promise<ValidationError[]> {
    logger.info('Starting migration validation...');
    const errors: ValidationError[] = [];
    
    // Helper function to process a key
    async function validateKey(key: string, type: 'story' | 'reply' | 'feed'): Promise<void> {
        const field = type === 'story' ? 'postTree' : type === 'reply' ? 'reply' : 'feedItem';
        try {
            const dataStr = await db.hGet(key, field, { returnCompressed: false });
            if (!dataStr) {
                return;
            }
            
            const data = JSON.parse(dataStr);
            const isValid = type === 'feed' ? isValidFeedItem(data) : isValidUnifiedNode(data);
            
            if (!isValid) {
                errors.push({
                    id: key,
                    type,
                    error: `Invalid ${type === 'feed' ? 'FeedItem' : 'UnifiedNode'} structure`,
                    data
                });
            }
        } catch (err) {
            errors.push({
                id: key,
                type,
                error: `Error processing object: ${err}`,
                data: null
            });
        }
    }
    
    // Validate story trees
    const storyIds = await getStoryIds(db);
    logger.info(`Validating ${storyIds.length} story trees...`);
    for (const id of storyIds) {
        await validateKey(id, 'story');
    }
    
    // Validate replies
    const replyIds = await getReplyIds(db);
    logger.info(`Validating ${replyIds.length} replies...`);
    for (const id of replyIds) {
        await validateKey(id, 'reply');
    }
    
    // Validate feed items
    const feedIds = await getFeedItems(db);
    logger.info(`Validating ${feedIds.length} feed items...`);
    for (const id of feedIds) {
        await validateKey(id, 'feed');
    }
    
    return errors;
}

// Function to write errors to DLQ file
function writeToDLQ(errors: ValidationError[]): void {
    if (errors.length === 0) {
        return;
    }
    
    const dlqPath = path.join(process.cwd(), DLQ_FILE);
    const dlqContent = JSON.stringify(errors, null, 2);
    fs.writeFileSync(dlqPath, dlqContent);
    logger.info(`Written ${errors.length} validation errors to ${DLQ_FILE}`);
}

// Helper function to get story IDs
async function getStoryIds(db: DatabaseClient): Promise<string[]> {
    // Get all story trees from the feed items
    const feedItems = await db.lRange('feedItems', 0, -1);
    const storyIds = new Set<string>();
    
    for (const value of feedItems) {
        try {
            const item = JSON.parse(value);
            if (item.id && item.id.startsWith('story-') && !item.id.includes('+')) {
                storyIds.add(item.id);
            }
        } catch (err) {
            // Skip invalid JSON
            continue;
        }
    }
    
    return Array.from(storyIds);
}

// Helper function to get reply IDs from a sorted set
async function getRepliesFromSortedSet(db: DatabaseClient, key: string): Promise<string[]> {
    try {
        return await db.zRange(key, 0, -1);
    } catch (err) {
        logger.error(`Error getting replies from sorted set ${key}:`, err);
        return [];
    }
}

// Helper function to get all reply IDs
async function getReplyIds(db: DatabaseClient): Promise<string[]> {
    const replyIds = new Set<string>();
    
    // Get replies from the global feed
    const globalFeedReplies = await getRepliesFromSortedSet(db, 'replies:feed:mostRecent');
    globalFeedReplies.forEach(id => replyIds.add(id));
    
    return Array.from(replyIds);
}

// Helper function to get feed items
async function getFeedItems(db: DatabaseClient): Promise<string[]> {
    const feedItems = await redisClient.lRange('feedItems', 0, -1);
    return feedItems;
}

// Migrate postTree records
async function migratePostTrees(db: DatabaseClient): Promise<void> {
    logger.info('Starting migration of story trees.');
    let storyIds: string[];
    try {
        storyIds = await getStoryIds(db);
        if (!storyIds || storyIds.length === 0) {
            logger.info("No story trees found.");
            return;
        }
    } catch (err) {
        logger.error('Error fetching story tree IDs:', err);
        return;
    }
    
    logger.info(`Found ${storyIds.length} story trees to migrate.`);
    
    for (const storyId of storyIds) {
        try {
            const oldData = await db.hGet(storyId, 'postTree', { returnCompressed: false });
            if (!oldData) {
                logger.warn(`No postTree data found for ${storyId}`);
                continue;
            }
            let oldNode: OldPostTree;
            try {
                // Handle both string and object data
                oldNode = typeof oldData === 'string' ? JSON.parse(oldData) : oldData;
            } catch(err) {
                logger.error(`Error parsing data for story ${storyId}:`, err);
                continue;
            }
            // If already migrated (i.e. field 'content' exists), skip
            if ((oldNode as any).content) {
                logger.info(`Story ${storyId} already migrated.`);
                continue;
            }
            
            // Handle title migration by prepending it to the content
            let content = oldNode.text;
            if (oldNode.metadata.title) {
                content = `# ${oldNode.metadata.title}\n\n${content}`;
            }
            
            // Create unified node structure for a story
            const unifiedNode: UnifiedNode = {
                id: oldNode.id,
                type: 'story',
                content: content,
                metadata: {
                    // Convert parentId from string|null to string[]|null
                    parentId: oldNode.parentId ? [oldNode.parentId] : null,
                    author: oldNode.metadata.author || '',
                    createdAt: oldNode.metadata.createdAt || new Date().toISOString(),
                    quote: oldNode.metadata.quote || undefined
                }
            };
            
            const newDataStr = JSON.stringify(unifiedNode);
            await db.hSet(storyId, 'postTree', newDataStr);
            logger.info(`Migrated story tree ${storyId}`);
        } catch(err) {
            logger.error(`Error migrating story tree ${storyId}:`, err);
        }
    }
}

// Migrate reply records
async function migrateReplies(db: DatabaseClient): Promise<void> {
    logger.info('Starting migration of replies.');
    let replyIds: string[];
    try {
        replyIds = await getReplyIds(db);
        if (!replyIds || replyIds.length === 0) {
            logger.info("No replies found.");
            return;
        }
    } catch (err) {
        logger.error('Error fetching reply IDs:', err);
        return;
    }
    
    logger.info(`Found ${replyIds.length} replies to migrate.`);
    
    for (const replyId of replyIds) {
        try {
            const oldDataStr = await db.hGet(replyId, 'reply', { returnCompressed: false });
            if (!oldDataStr) {
                logger.warn(`No reply data found for ${replyId}`);
                continue;
            }
            let oldReply: OldReply;
            try {
                oldReply = JSON.parse(oldDataStr);
            } catch(err) {
                logger.error(`Error parsing JSON for reply ${replyId}:`, err);
                continue;
            }
            // If already migrated (i.e. field 'content' exists), skip
            if ((oldReply as any).content) {
                logger.info(`Reply ${replyId} already migrated.`);
                continue;
            }
            
            // Create unified node structure for a reply
            const unifiedNode: UnifiedNode = {
                id: oldReply.id,
                type: 'reply',
                content: oldReply.text,
                metadata: {
                    parentId: oldReply.parentId,
                    author: oldReply.metadata.author,
                    createdAt: oldReply.metadata.createdAt || new Date().toISOString(),
                    quote: oldReply.quote || undefined
                }
            };
            
            const newDataStr = JSON.stringify(unifiedNode);
            await db.hSet(replyId, 'reply', newDataStr);
            logger.info(`Migrated reply ${replyId}`);
        } catch(err) {
            logger.error(`Error migrating reply ${replyId}:`, err);
        }
    }
}

// Migrate feed items
async function migrateFeedItems(db: DatabaseClient): Promise<void> {
    logger.info('Starting feed items migration...');
    const feedItems = await db.lRange('feedItems', 0, -1, { returnCompressed: false });
    logger.info(`Found ${feedItems.length} feed items to migrate`);

    for (let i = 0; i < feedItems.length; i++) {
        try {
            const oldData = feedItems[i];
            const oldFeedItem = typeof oldData === 'string' ? JSON.parse(oldData) : oldData;

            // Create new feed item without title field
            const newFeedItem = {
                id: oldFeedItem.id,
                text: oldFeedItem.title ? `# ${oldFeedItem.title}\n\n${oldFeedItem.text}` : oldFeedItem.text,
                author: oldFeedItem.author,
                createdAt: oldFeedItem.createdAt
            };

            try {
                await db.lSet('feedItems', i, JSON.stringify(newFeedItem));
                logger.info(`Migrated feed item ${oldFeedItem.id}`);
            } catch (err) {
                logger.error(`Error setting feed item at index ${i}:`, err);
                logger.error('Feed item data:', newFeedItem);
                continue;
            }
        } catch (err) {
            logger.error(`Error processing feed item at index ${i}:`, err);
            continue;
        }
    }
    logger.info('Completed feed items migration');
}

// Main function to run the migration
async function migrate(db: DatabaseClient): Promise<void> {
    try {
        await db.connect();
        await redisClient.connect();  // Ensure feed client is also connected
        logger.info('Database connected for migration.');
        
        // Run migration
        await migratePostTrees(db);
        await migrateReplies(db);
        await migrateFeedItems(db);
        logger.info('Migration completed. Starting validation...');
        
        // Validate migration
        const validationErrors = await validateMigration(db);
        
        // Write any errors to DLQ
        writeToDLQ(validationErrors);
        
        // Throw error if validation failed
        if (validationErrors.length > 0) {
            throw new Error(
                `Migration validation failed. Found ${validationErrors.length} invalid objects. ` +
                `Check ${DLQ_FILE} for details.`
            );
        }
        
        logger.info('Migration completed and validated successfully.');
    } catch(err) {
        logger.error('Migration encountered an error:', err);
        process.exit(1);
    } finally {
        // Clean up both Redis clients
        try {
            await redisClient.disconnect();
            if (db.disconnect) {
                await db.disconnect();
            }
        } catch (err) {
            logger.error('Error disconnecting Redis clients:', err);
        }
        process.exit(0);
    }
}

// Run the migration
migrate(createDatabaseClient()); 