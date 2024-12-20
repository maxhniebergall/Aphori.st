import { createDatabaseClient } from './db/index.js';
import newLogger from './logger.js';
import { fileURLToPath } from 'url';

const logger = newLogger("prodSeed.js");

const DEFAULT_STORY_TREES = [
  {
    id: 'default-1',
    text: 'The aphorist collects knowledge in short sayings',
    title: 'The aphorist',
    nodes: [],
    metadata: {
      author: 'System',
      title: 'The aphorist'
    }
  },
  {
    id: 'default-2',
    text: 'Where wisdom is discussed',
    title: 'Aphori.st is a social medium for good',
    nodes: [],
    metadata: {
      author: 'System',
      title: 'Aphori.st is a social medium for good'
    }
  },
  {
    id: 'default-3',
    text: '1: a concise statement of a principle\n2: a terse formulation of a truth or sentiment : adage\n\n- https://www.merriam-webster.com/dictionary/aphorism',
    title: 'An aphorism',
    nodes: [],
    metadata: {
      author: 'System',
      title: 'An aphorism'
    }
  }
];

async function seedDefaultStories() {
  const db = createDatabaseClient();
  
  try {
    await db.connect();
    logger.info('Connected to database');

    for (const story of DEFAULT_STORY_TREES) {
      // Check if story exists
      const existing = await db.hGet(story.id, 'storyTree');
      
      if (!existing) {
        logger.info(`Seeding default story: ${story.id}`);
        
        // Store in database
        await db.hSet(story.id, 'storyTree', JSON.stringify(story));
        
        // Add to feed items
        const feedItem = {
          id: story.id,
          title: story.title,
          text: story.text
        };
        await db.lPush('feedItems', JSON.stringify(feedItem));
        
        logger.info(`Successfully seeded story ${story.id}`);
      } else {
        logger.info(`Story ${story.id} already exists, skipping`);
      }
    }
  } catch (error) {
    logger.error('Error seeding default stories:', error);
    throw error;
  } finally {
    await db.disconnect();
    logger.info('Disconnected from database');
  }
}

// Only run seeding if this file is executed directly
if (import.meta.url === fileURLToPath(import.meta.url)) {
  seedDefaultStories().catch(console.error);
}

export { seedDefaultStories }; 