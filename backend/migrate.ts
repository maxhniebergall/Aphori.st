/*
Migration Script for Unified Node Structure

This script migrates existing storyTree and reply records to the new unified node structure.
For storyTree records:
  - Renames 'text' to 'content'
  - Adds a 'type' field with value 'story'
  - Ensures metadata includes parentId, author, createdAt, title, and quote (defaulting to null)

For reply records:
  - Renames 'text' to 'content'
  - Adds a 'type' field with value 'reply'
  - Moves the 'quote' field into metadata
  - Ensures metadata includes parentId, author, createdAt

Run this script with Node.js (e.g., ts-node backend/migrate.ts) after compiling if needed.
*/

import dotenv from 'dotenv';
dotenv.config();

import { createDatabaseClient } from './db/index.js';
import newLogger from './logger.js';
import { UnifiedNode } from './types/index.js';

// Assuming DatabaseClient interface is available from our types
import { DatabaseClient } from './types/index.js';

const logger = newLogger('migrate.ts');

// Define interfaces for old data formats
interface OldStoryTree {
  id: string;
  text: string;
  parentId: string | null;
  metadata: {
    author: string;
    createdAt?: string;
    title: string;
    quote?: any;
  };
}

interface OldReply {
  id: string;
  text: string;
  parentId: string[];
  metadata: {
    author: string;
    createdAt?: string;
  };
  quote?: any;
}

// Migrate storyTree records using the list 'allStoryTreeIds'
async function migrateStoryTrees(db: DatabaseClient): Promise<void> {
  logger.info('Starting migration of story trees.');
  let storyIds: string[];
  try {
    storyIds = await db.lRange('allStoryTreeIds', 0, -1);
    if (!storyIds || storyIds.length === 0) {
      logger.info("No story trees found in 'allStoryTreeIds'.");
      return;
    }
  } catch (err) {
    logger.error('Error fetching story tree IDs:', err);
    return;
  }
  
  logger.info(`Found ${storyIds.length} story trees to migrate.`);
  
  for (const storyId of storyIds) {
    try {
      const oldDataStr = await db.hGet(storyId, 'storyTree', { returnCompressed: false });
      if (!oldDataStr) {
         logger.warn(`No storyTree data found for ${storyId}`);
         continue;
      }
      let oldNode: OldStoryTree;
      try {
         oldNode = JSON.parse(oldDataStr);
      } catch(err) {
         logger.error(`Error parsing JSON for story ${storyId}:`, err);
         continue;
      }
      // If already migrated (i.e. field 'content' exists), skip
      if ((oldNode as any).content) {
         logger.info(`Story ${storyId} already migrated.`);
         continue;
      }
      
      // Create unified node structure for a story
      const unifiedNode: UnifiedNode = {
         id: oldNode.id,
         type: 'story',
         content: oldNode.text,
         metadata: {
            // Convert parentId from string|null to string[]|null
            parentId: oldNode.parentId ? [oldNode.parentId] : null,
            author: oldNode.metadata.author,
            createdAt: oldNode.metadata.createdAt || new Date().toISOString(),
            title: oldNode.metadata.title,
            quote: oldNode.metadata.quote || null
         }
      };
      
      const newDataStr = JSON.stringify(unifiedNode);
      await db.hSet(storyId, 'storyTree', newDataStr);
      logger.info(`Migrated story tree ${storyId}`);
    } catch(err) {
      logger.error(`Error migrating story tree ${storyId}:`, err);
    }
  }
}

// Helper function to scan keys and find those with a 'reply' field
async function scanKeysForReplies(db: DatabaseClient): Promise<string[]> {
  let cursor = '0';
  let keys: string[] = [];
  try {
    do {
      // Casting db to any because scan may not be defined in DatabaseClient
      const result: [string, string[]] = await (db as any).scan(cursor, 'MATCH', '*', 'COUNT', 100);
      cursor = result[0];
      const foundKeys = result[1];
      for (const key of foundKeys) {
         const replyField = await db.hGet(key, 'reply');
         if (replyField) {
            keys.push(key);
         }
      }
    } while (cursor !== '0');
  } catch(err) {
    logger.error('Error scanning keys for replies:', err);
  }
  return keys;
}

// Migrate reply records
async function migrateReplies(db: DatabaseClient): Promise<void> {
  logger.info('Starting migration of replies.');
  const replyKeys = await scanKeysForReplies(db);
  logger.info(`Found ${replyKeys.length} replies to migrate.`);
  
  for (const key of replyKeys) {
    try {
      const oldDataStr = await db.hGet(key, 'reply', { returnCompressed: false });
      if (!oldDataStr) {
         logger.warn(`No reply data found for ${key}`);
         continue;
      }
      let oldReply: OldReply;
      try {
         oldReply = JSON.parse(oldDataStr);
      } catch(err) {
         logger.error(`Error parsing JSON for reply ${key}:`, err);
         continue;
      }
      // If already migrated, skip
      if ((oldReply as any).content) {
         logger.info(`Reply ${key} already migrated.`);
         continue;
      }
      
      // Create unified reply structure
      const unifiedReply: UnifiedNode = {
         id: oldReply.id,
         type: 'reply',
         content: oldReply.text,
         metadata: {
            parentId: oldReply.parentId, // should already be an array
            author: oldReply.metadata.author,
            createdAt: oldReply.metadata.createdAt || new Date().toISOString(),
            quote: oldReply.quote || null
         }
      };
      
      const newDataStr = JSON.stringify(unifiedReply);
      await db.hSet(key, 'reply', newDataStr);
      logger.info(`Migrated reply ${key}`);
    } catch(err) {
      logger.error(`Error migrating reply ${key}:`, err);
    }
  }
}

async function runMigration(): Promise<void> {
  const db: DatabaseClient = createDatabaseClient();
  try {
    await db.connect();
    logger.info('Database connected for migration.');
    await migrateStoryTrees(db);
    await migrateReplies(db);
    logger.info('Migration completed successfully.');
  } catch(err) {
    logger.error('Migration encountered an error:', err);
  } finally {
    process.exit(0);
  }
}

runMigration(); 