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
import { DatabaseClient, FeedItem, Post, Reply, Quote } from './types/index.js';

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

        const storyIds: string[] = [];

        // Create each story
        for (const story of sampleStories) {
            const uuid = crypto.randomUUID();
            storyIds.push(uuid);
            
            // Create the story following Post schema structure
            const formattedStory: Post = {
                id: uuid,
                content: story.content,
                authorId: 'seed_user',
                createdAt: new Date().toISOString(),
                quote: undefined // Root-level posts don't have quotes
            };

            // Store in Redis - let the database client handle compression
            await db.hSet(uuid, 'post', formattedStory);
            await db.lPush('allStoryTreeIds', uuid);

            // Add to feed items (only root-level posts go to feed)
            const feedItem = {
                id: uuid,
                text: formattedStory.content,
                authorId: formattedStory.authorId,
                createdAt: formattedStory.createdAt
            } as FeedItem;
            await db.lPush('feedItems', feedItem);
            logger.info(`Added feed item for story ${JSON.stringify(feedItem)}`);

            logger.info(`Created new story with UUID: ${uuid}`);
        }

        logger.info(`Successfully seeded ${sampleStories.length} stories`);

        // Seed test replies
        await seedTestReplies(storyIds);
    } catch (error) {
        logger.error('Error seeding stories:', error);
        throw error;
    }
}

async function seedTestReplies(storyIds: string[]): Promise<void> {
    try {
        logger.info("Seeding test replies...");

        for (const storyId of storyIds) {
            // Create a test reply for each story
            const replyId = crypto.randomUUID();
            const timestamp = Date.now();

            // Create a test quote targeting the first character of the story
            const quote = {
                text: "content",
                sourcePostId: "content",
                selectionRange: {
                    start: 0,
                    end: 1
                }
            } as Quote;

            // Create the reply object
            const reply = {
                id: replyId,
                text: "This is a test reply to help with testing the reply functionality.",
                parentId: [storyId],
                quote: quote,
                authorId: 'seed_user',
                createdAt: new Date().toISOString()
            } as Reply;

            // Store the reply in Redis
            await db.hSet(replyId, 'reply', reply);

            // Add to various indices
            const quoteKey = `${quote.text}|${quote.sourcePostId}|${quote.selectionRange.start}-${quote.selectionRange.end}`;

            // 1. Global replies feed
            await db.zAdd('replies:feed:mostRecent', timestamp, replyId);

            // 2. Replies by Quote (General)
            await db.zAdd(`replies:quote:${quoteKey}:mostRecent`, timestamp, replyId);

            // 3. Replies by Parent ID and Detailed Quote
            await db.zAdd(`replies:uuid:${storyId}:quote:${quoteKey}:mostRecent`, timestamp, replyId);

            // 4. Replies by Parent ID and Quote Text
            await db.zAdd(`replies:${storyId}:${quote.text}:mostRecent`, timestamp, replyId);

            // 5. Conditional Replies by Quote Text Only
            await db.zAdd(`replies:quote:${quote.text}:mostRecent`, timestamp, replyId);

            // Increment the quote count
            await db.hIncrBy(`${storyId}:quoteCounts`, JSON.stringify(quote), 1);

            logger.info(`Created test reply with ID: ${replyId} for story: ${storyId}`);
        }

        logger.info(`Successfully seeded ${storyIds.length} test replies`);
    } catch (error) {
        logger.error('Error seeding test replies:', error);
        throw error;
    }
}

export { seedDevStories }; 