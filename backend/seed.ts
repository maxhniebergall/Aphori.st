/*
Requirements:
- Seed script must clear existing feed items before adding new ones
- Each story must have a unique UUID
- Stories must be stored in Redis with proper metadata
- Must use backend server's database client for compression support
- Must be exportable as a function for programmatic seeding
- Must maintain idempotency when run multiple times
*/

import { createClient, RedisClientType } from 'redis';
import crypto from "crypto";
import newLogger from './logger.js';
import { createDatabaseClient } from './db/index.js';
import { DatabaseClient, FeedItem, UnifiedNode } from './types/index.js';

const logger = newLogger("seed.ts");

interface StoryContent {
    content: string;
}

let db: DatabaseClient;
let client: RedisClientType;

if (process.env.NODE_ENV !== 'production') {
    client = createClient({
        socket: {
            port: 6379,
            host: process.env.REDIS_SERVER_IP
        }
    });

    db = createDatabaseClient();

    client.on('error', (err: Error) => {
        logger.error('Redis Client Error', err);
    });

    client.on('connect', () => {
        logger.info('Connected to Redis');
    });

    await client.connect();
    await db.connect();

    // At the start of your seed script, clear existing feed items
    await client.del('feedItems');
    await client.del('allStoryTreeIds');
}

// List of sample stories
const sampleStories: StoryContent[] = [
    {
        content: "The waves crashed against the rocky shoreline with relentless fury, sending plumes of salty spray high into the air. The ancient cliffs, weathered by countless storms, stood as silent sentinels against nature's onslaught."
    },
    {
        content: "The lighthouse stood tall against the turbulent backdrop, its weathered white paint peeling in strips from decades of exposure to the harsh maritime elements."
    },
    {
        content: "The keeper watched diligently from his perch high above the churning waters, his experienced eyes scanning the horizon for any signs of vessels in distress."
    }
];

async function seedDevStories(dbClient: DatabaseClient): Promise<void> {
    try {
        db = dbClient;
        logger.info("Attempting to seed data");

        // Clear existing feed items and story IDs
        if (client) {
            await client.del('feedItems');
            await client.del('allStoryTreeIds');
            logger.info("Existing feed items cleared");
        }

        // Create each story
        for (const story of sampleStories) {
            const uuid = crypto.randomUUID();
            
            // Create the story following UnifiedNode schema structure
            const formattedStory: UnifiedNode = {
                id: uuid,
                type: 'story',
                content: story.content,
                metadata: {
                    parentId: null, // Root-level posts always have null parentId
                    authorId: 'seed_user',
                    createdAt: new Date().toISOString(),
                    quote: undefined // Root-level posts don't have quotes
                }
            };

            // Store in Redis - let the database client handle compression
            await db.hSet(uuid, 'storyTree', formattedStory);
            await db.lPush('allStoryTreeIds', uuid);

            // Add to feed items (only root-level posts go to feed)
            const feedItem = {
                id: uuid,
                text: formattedStory.content,
                authorId: formattedStory.metadata.authorId,
                createdAt: formattedStory.metadata.createdAt
            } as FeedItem;
            await db.lPush('feedItems', feedItem);
            logger.info(`Added feed item for story ${JSON.stringify(feedItem)}`);

            logger.info(`Created new story with UUID: ${uuid}`);
        }

        logger.info(`Successfully seeded ${sampleStories.length} stories`);
    } catch (error) {
        logger.error('Error seeding stories:', error);
        throw error;
    }
}

export { seedDevStories }; 