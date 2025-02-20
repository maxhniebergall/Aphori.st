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
import { DatabaseClient, StoryMetadata, FeedItem, UnifiedNode } from './types/index.js';

const logger = newLogger("seed.ts");

interface StoryNode {
    content: string;
    children: StoryNode[];
}

interface Story {
    uuid: string;
    text: StoryNode;
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
}

// List of sample authors
const authors: string[] = [
    'John Doe',
    'Jane Smith',
    'Alice Johnson',
    'Bob Brown',
    'Carol White',
];

// Move stories array outside function to avoid recreating it on each call
const newStories: Story[] = [
    {
        uuid: 'story-' + crypto.randomUUID(),
        text: {
            content: "The waves crashed against the rocky shoreline with relentless fury, sending plumes of salty spray high into the air. The ancient cliffs, weathered by countless storms, stood as silent sentinels against nature's onslaught.",
            children: [
                {
                    content: "The lighthouse stood tall against the turbulent backdrop, its weathered white paint peeling in strips from decades of exposure to the harsh maritime elements. The structure's foundation, built from massive granite blocks quarried from these very cliffs, had withstood over a century of storms.",
                    children: [
                        {
                            content: "The keeper watched diligently from his perch high above the churning waters, his experienced eyes scanning the horizon for any signs of vessels in distress.",
                            children: [
                                {
                                    content: "As dawn broke, the sea calmed, transforming from a raging monster into a gentle giant. The lighthouse keeper, having maintained his vigil through the night, allowed himself a small smile of satisfaction.",
                                    children: []
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    }
    // Add more stories as needed...
];

async function seedDevStories(db: DatabaseClient): Promise<void> {
    try {
        logger.info("Attempting to seed data");

        // Clear existing feed items and replies using Redis client
        if (client) {
            await client.del('feedItems');
            await client.del('replies:feed:mostRecent');
            logger.info("Existing feed items and replies cleared");
        }

        // Add the new stories and get their IDs
        const storyIds = await addMultipleStories(newStories);
        
        if (!storyIds || storyIds.length === 0) {
            throw new Error('No story IDs returned from addMultipleStories');
        }

        logger.info(`Successfully seeded ${storyIds.length} stories`);
    } catch (error) {
        logger.error('Error seeding stories:', error);
        throw error;
    }
}

async function addMultipleStories(stories: Story[]): Promise<string[]> {
    const storyIds: string[] = [];
    for (const story of stories) {
        try {
            logger.info(`Creating story with ID: ${story.uuid}`);
            await createStoryTree(story.uuid, story.text);
            storyIds.push(story.uuid);
        } catch (err) {
            logger.error(`Error creating story ${story.uuid}:`, err);
        }
    }
    logger.info(`Created ${storyIds.length} stories with IDs:`, storyIds);
    return storyIds;
}

async function createStoryTree(uuid: string, storyText: StoryNode): Promise<void> {
    const author = authors[Math.floor(Math.random() * authors.length)];
    const metadata: StoryMetadata = {
        author,
        createdAt: new Date().toISOString(),
        quote: null
    };

    try {
        // Create the entire tree structure recursively
        await createStoryTreeRecursive(uuid, storyText, metadata, "root");

        // Add to feed items
        const feedItem: FeedItem = {
            id: uuid,
            text: storyText.content,
            author: {
                id: uuid
            },
            createdAt: new Date().toISOString()
        };
        await db.lPush('feedItems', JSON.stringify(feedItem));
        logger.info(`Added feed item for story ${JSON.stringify(feedItem)}`);

    } catch (err) {
        logger.error('Error saving StoryTree:', err);
        throw err;
    }
}

async function createStoryTreeRecursive(
    nodeId: string,
    storyNode: StoryNode,
    metadata: StoryMetadata,
    parentId: string | null
): Promise<string> {
    const childIds: string[] = [];

    // Create this node first
    await createStoryTreeNode(nodeId, storyNode.content, metadata, parentId);

    // Then create all child nodes recursively
    if (storyNode.children && storyNode.children.length > 0) {
        for (const child of storyNode.children) {
            const childId = `${nodeId}+${crypto.randomUUID()}`;
            await createStoryTreeRecursive(childId, child, metadata, nodeId);
            childIds.push(childId);
        }

        // Update the parent node with child IDs
        const updatedNode: UnifiedNode = {
            id: nodeId,
            type: 'story',
            content: storyNode.content,
            metadata: {
                parentId: parentId ? [parentId] : null,
                author: metadata.author || '',
                createdAt: metadata.createdAt,
                quote: metadata.quote || undefined
            }
        };
        await db.hSet(nodeId, "storyTree", JSON.stringify(updatedNode));
    }

    return nodeId;
}

async function createStoryTreeNode(
    nodeId: string,
    content: string,
    metadata: StoryMetadata,
    parentId: string | null
): Promise<UnifiedNode> {
    // Create the unified node structure
    const unifiedNode: UnifiedNode = {
        id: nodeId,
        type: 'story',
        content: content,
        metadata: {
            parentId: parentId ? [parentId] : null,
            author: metadata.author || '',
            createdAt: metadata.createdAt,
            quote: metadata.quote || undefined
        }
    };

    // Store in Redis using the database client's compression
    await db.hSet(nodeId, "storyTree", JSON.stringify(unifiedNode));

    return unifiedNode;
}

export { seedDevStories }; 