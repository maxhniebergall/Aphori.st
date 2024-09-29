// backend/seed.js
import { createClient } from 'redis';
import newLogger from './logger.js';
const logger = newLogger()

logger.info("Attempting to seed data")

const client = createClient({
    socket: {
        port: 6379,
        host: process.env.REDIS_SERVER_IP
    }
});

client.on('error', (err) => {
  logger.error('Redis Client Error', err);
});

client.on('connect', () => {
  logger.info('Connected to Redis');
});

(async () => {
    await client.connect();
  
    logger.info('Connected to Redis, seeding data...');
  
    // Sample StoryTree data
    const storyTree = {
      metadata: {
        author: 'John Doe',
        title: 'An Epic Tale',
      },
      nodes: [
        { id: 'node-1', text: 'Once upon a time...' },
        { id: 'node-2', text: 'The journey continues...' },
        { id: 'node-3', text: 'The end is near...' },
      ],
    };
  
    // Save the StoryTree under a UUID
    const uuid = 'story-1234';
  
    try {
      await client.hSet('storyTrees', uuid, JSON.stringify(storyTree));
      logger.info('StoryTree saved.');
  
      // Sample Feed data
      const feedItems = [
        { id: 'story-1234', text: 'An Epic Tale' },
        { id: 'story-5678', text: 'Another Great Story' },
        // Add more items as needed
      ];
  
      // Save feed items as a list
      const feedItemsStrings = feedItems.map((item) => JSON.stringify(item));
  
      // Delete existing feedItems list
      await client.del('feedItems');
  
      // Add new feed items
      await client.rPush('feedItems', feedItemsStrings);
      logger.info('Feed items saved.');
    } catch (err) {
      logger.error('Error seeding data:', err);
    } finally {
      await client.disconnect();
    }
  })();