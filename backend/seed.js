// backend/seed.js
import { redis } from 'redis';

const client = redis.createClient({
  host: process.env.REDIS_SERVER_IP || 'localhost',
  port: 6379,
});

client.on('error', (err) => {
  console.error('Redis error:', err);
});

client.on('connect', async () => {
  console.log('Connected to Redis, seeding data...');

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

  client.hset('storyTrees', uuid, JSON.stringify(storyTree), (err, reply) => {
    if (err) {
      console.error('Error saving StoryTree:', err);
    } else {
      console.log('StoryTree saved:', reply);
    }

    // Close the Redis connection
    client.quit();
  });

  // Add this inside the client.on('connect', async () => { ... });

  // Sample Feed data
  const feedItems = [
    { id: 'story-1234', text: 'An Epic Tale' },
    { id: 'story-5678', text: 'Another Great Story' },
    // Add more items as needed
  ];

  // Save feed items as a list
  const feedItemsStrings = feedItems.map((item) => JSON.stringify(item));

  client.del('feedItems', () => {
    client.rpush('feedItems', feedItemsStrings, (err, reply) => {
      if (err) {
        console.error('Error saving feed items:', err);
      } else {
        console.log('Feed items saved:', reply);
      }

      // Close the Redis connection
      client.quit();
    });
  });

});
