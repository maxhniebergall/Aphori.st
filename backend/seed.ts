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
import { getQuoteKey } from './utils/quoteUtils.js';

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
        const storyContents: string[] = [];

        // Create each story
        for (const story of sampleStories) {
            const uuid = crypto.randomUUID();
            storyIds.push(uuid);
            storyContents.push(story.content);
            
            // Create the story following Post schema structure
            const formattedStory: Post = {
                id: uuid,
                content: story.content,
                authorId: 'seed_user',
                createdAt: new Date().toISOString(),
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
        await seedTestReplies(storyIds, storyContents);
    } catch (error) {
        logger.error('Error seeding stories:', error);
        throw error;
    }
}

async function seedTestReplies(storyIds: string[], storyContents: string[]): Promise<void> {
    try {
        logger.info("Seeding test replies...");
        for (const storyId of storyIds) {
            const storyContent = storyContents[storyIds.indexOf(storyId)];
            for (let storyIdReplyNumber = 0; storyIdReplyNumber < 10; storyIdReplyNumber++) {
                const replyId = crypto.randomUUID();
                // Create a test reply for each story
                const timestamp = Date.now();
                const replyText = `This is a test reply (to a story tree) to help with testing the reply functionality. storyId: [${storyId}], storyIdReplyNumber: [${storyIdReplyNumber}].`;

                // Create a test quote targeting the entire text of the parent post
                const quote = {
                    text: storyContent,
                    sourcePostId: storyId,
                    selectionRange: {
                        start: 0,
                        end: storyContent.length
                    }
                } as Quote;

                // Create the reply object
                const reply = {
                    id: replyId,
                    text: replyText,
                    parentId: [storyId],
                    quote: quote,
                    authorId: 'seed_user',
                    createdAt: timestamp.toString()
                } as Reply;

                // Store the reply in Redis
                await storeReply(reply);
                // create replies to the reply
                for (let replyReplyNumber = 0; replyReplyNumber < 4; replyReplyNumber++) {
                    // Create a test reply for each story
                    const replyReplyId = crypto.randomUUID();
                    const timestamp = Date.now();
                    const replyReplyText = `This is a test reply (to a reply) to help with testing the reply functionality. storyId: [${storyId}], storyIdReplyNumber: [${storyIdReplyNumber}], replyReplyNumber: [${replyReplyNumber}].`;

                    // Create a test quote targeting the entire text of the parent post
                    const quote = {
                        text: replyText,
                        sourcePostId: replyId,
                        selectionRange: {
                            start: 0,
                            end: replyText.length
                        }
                    } as Quote;

                    // Create the reply object
                    const replyReply = {
                        id: replyReplyId,
                        text: replyReplyText,
                        parentId: [replyId],
                        quote: quote,
                        authorId: 'seed_user',
                        createdAt: timestamp.toString()
                    } as Reply;

                    // Store the reply in Redis
                        await storeReply(replyReply);
                }
            }
        }

        logger.info(`Successfully seeded ${storyIds.length} test replies`);
    } catch (error) {
        logger.error('Error seeding test replies:', error);
        throw error;
    }
}

async function storeReply(reply: Reply) {
    const replyId = reply.id;
    const quote = reply.quote;
    const timestamp = parseInt(reply.createdAt);
    const storyId = reply.parentId[0];

    // Store the reply itself
    await db.hSet(replyId, 'reply', reply);

    // Add to various indices
    const quoteKey = getQuoteKey(quote);

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

export { seedDevStories }; 