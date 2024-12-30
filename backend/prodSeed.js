/*
Requirements:
- Must create proper story tree nodes for each text entry
- Must maintain unique IDs for each node
- Must properly link parent and child nodes
- Must preserve metadata across all nodes
- Must use Redis database client for storage
- Must handle error cases gracefully
*/

import newLogger from './logger.js';

const logger = newLogger("prodSeed.js");

const DEFAULT_STORY_TREES = [
  {
    id: 'default-1',
    text: 'The aphorist collects knowledge in short sayings',
    title: 'The aphorist',
    nodes: [],
    metadata: {
      author: 'MaxHniebergall',
      title: 'The aphorist'
    }
  },
  {
    id: 'default-2',
    text: 'Where wisdom is discussed',
    title: 'Aphori.st is a social medium for good',
    nodes: [],
    metadata: {
      author: 'MaxHniebergall',
      title: 'Aphori.st is a social medium for good'
    }
  },
  {
    id: 'default-3',
    text: 'What is an aphorism?',
    title: 'Aphorism',
    childTexts: [
      'An Aphorism a heurisitic which helps us to make good choices and communicate wisdom (Aphori.st)',
      'An "aphorism" is a concise statement of a principle (https://www.merriam-webster.com/dictionary/aphorism)', 
      'An "aphorism" is terse formulation of a truth or sentiment (https://www.merriam-webster.com/dictionary/aphorism)', 
    ],
    nodes: [],
    metadata: {
      author: 'MaxHniebergall',
      title: 'Aphorism'
    }
  }
];

async function createStoryTreeNode(nodeId, content, childNodes, metadata, parentId = null) {
  // Format nodes array to match frontend expectations
  const nodes = childNodes.map(childId => ({
    id: childId,
    parentId: nodeId
  }));

  // Create the full object for returning to API
  const storyTree = {
    id: nodeId,
    text: content,
    nodes: nodes,
    parentId,
    metadata: {
      title: metadata.title,
      author: metadata.author
    },
    totalNodes: nodes.length
  };

  return storyTree;
}

async function seedDefaultStories(db) {
  try {
    logger.info('Starting to seed default stories');

    for (const story of DEFAULT_STORY_TREES) {
      // Check if story exists
      const existing = await db.hGet(story.id, 'storyTree');
      
      if (!existing) {
        logger.info(`Seeding default story: ${story.id}`);
        
        // Create child nodes if they exist
        const childNodes = [];
        if (story.childTexts && story.childTexts.length > 0) {
          let counter = 0;
          for (const childText of story.childTexts) {
            const childId = `${story.id}-${counter}`;
            const childNode = await createStoryTreeNode(
              childId,
              childText,
              [], // No grandchildren for now
              story.metadata,
              story.id
            );
            childNodes.push(childId);
            counter +=1
            
            // Store child node
            await db.hSet(childId, 'storyTree', JSON.stringify(childNode));
          }
        }
        
        // Create and store parent node
        const parentNode = await createStoryTreeNode(
          story.id,
          story.text,
          childNodes,
          story.metadata
        );
        await db.hSet(story.id, 'storyTree', JSON.stringify(parentNode));
        
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
  }
}

export { seedDefaultStories }; 