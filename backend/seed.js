// backend/seed.js
import { createClient } from 'redis';
import crypto from "crypto"
import newLogger from './logger.js';
const logger = newLogger("seed.js")

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

await client.connect();

// List of sample authors and titles
const authors = [
  'John Doe',
  'Jane Smith',
  'Alice Johnson',
  'Bob Brown',
  'Carol White',
];

const titles = [
  'An Epic Tale',
  'The Mysterious Journey',
  'Adventures in Wonderland',
  'The Lost Treasure',
  'Chronicles of Time',
];

/**
 * Creates a StoryTree and saves it to Redis.
 *
 * @param {string} uuid - The unique identifier for the story.
 * @param {string} storyText - The full story text.
 */
async function createStoryTree(uuid, storyText) {
  const author = authors[Math.floor(Math.random() * authors.length)];
  const title = titles[Math.floor(Math.random() * titles.length)] + " " +  uuid;

  // Split the story text into nodes delimited by new lines
  const lines = storyText.split('\n').filter((line) => line.trim() !== '');

  try {
    let rootStoryTree = {
      metadata: {
        author,
        title,
      },
      id: `${uuid}`,
      text: lines[0].trim(),
      nodes: []
    }

    let node = rootStoryTree;
    for (let i = 1; i < lines.length; i++) {
      let storyTree = {
        metadata: {
          author,
          title,
        },
        id: `${uuid}-node-${i}`,
        text: lines[i].trim(),
        nodes: [node]
      }
      await client.hSet(node.id, "storyTree", JSON.stringify(rootStoryTree));
      node = storyTree;
    }

    // Update the feed items - make sure the feedItem is a proper object
    const feedItem = {
      id: uuid,
      text: title
    };

    // Verify the JSON is valid before storing
    const jsonString = JSON.stringify(feedItem);
    console.log('Storing feed item:', jsonString); // Add this for debugging

    // Add the new feed item to the feed
    const queueLength = await client.rPush('feedItems', jsonString);
    logger.info('Feed item added. Feed length: ' + queueLength);
  } catch (err) {
    logger.error('Error saving StoryTree:', err);
  }
}

// At the start of your seed script, clear existing feed items
await client.del('feedItems');

// Array of new stories to add
const newStories = [
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    The waves crashed against the rocky shoreline.
    A lone lighthouse stood tall, guiding ships through the storm.
    The keeper watched diligently, knowing lives depended on him.
    As dawn broke, the sea calmed, and a new day began.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    In a bustling city, amidst the noise and chaos, she found solace in her art.
    Each stroke of the brush brought her closer to peace.
    Her paintings reflected the beauty she saw in everyday life.
    One day, the world noticed her talent, changing her life forever.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    The ancient ruins held secrets untold.
    Explorers ventured deep within, seeking knowledge and treasure.
    Traps and puzzles tested their wits at every turn.
    Ultimately, they discovered that wisdom was the greatest treasure of all.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    A small seedling pushed through the soil, reaching for the sun.
    Seasons passed, and it grew into a magnificent tree.
    It provided shelter and nourishment to countless creatures.
    Its existence showed the profound impact of growth and perseverance.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    The melody drifted through the air, enchanting all who heard it.
    A young musician played with passion unmatched.
    His music spoke the words his voice could not.
    Through harmony, he connected souls across the world.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    Beneath the starry sky, they made a promise.
    No matter the distance, their friendship would endure.
    Years later, they reunited, memories flooding back.
    Time had changed them, but their bond remained unbroken.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    The inventor toiled away in his workshop.
    Failures mounted, but he refused to give up.
    Finally, his creation sprang to life, changing technology forever.
    His persistence proved that innovation requires dedication.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    The village nestled in the valley was hidden from the world.
    Its people lived in harmony with nature.
    One day, a traveler stumbled upon it, sharing tales of distant lands.
    The encounter forever enriched both the traveler and the villagers.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    She stood at the crossroads, choices laid out before her.
    Each path promised different adventures and challenges.
    Taking a deep breath, she chose the road less traveled.
    Her journey was filled with unexpected joys and discoveries.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    The old bookstore was a labyrinth of stories.
    Among dusty shelves, he found a mysterious tome.
    As he read, the line between fiction and reality blurred.
    The book held secrets that would change his life.
    `,
  },
];

// Function to add multiple stories
async function addMultipleStories(stories) {
  for (const story of stories) {
    await createStoryTree(story.uuid, story.text);
  }
}


// Add the new stories
await addMultipleStories(newStories);

await client.disconnect();
logger.info('Disconnected from Redis.');
