/*
Requirements:
- Seed script must clear existing feed items before adding new ones
- Story titles should be descriptive and engaging
- Each story must have a unique UUID
- Stories must be stored in Redis with proper metadata
- Must use backend server's database client for compression support
- Must be exportable as a function for programmatic seeding
- Must maintain idempotency when run multiple times
*/

// backend/seed.js
import { createClient } from 'redis';
import crypto from "crypto"
import newLogger from './logger.js';
import { createDatabaseClient } from './db/index.js';

const logger = newLogger("seed.js")

let db;
let client;

if (process.env.NODE_ENV !== 'production') {

  client = createClient({
    socket: {
      port: 6379,
      host: process.env.REDIS_SERVER_IP
    }
  });

  db = createDatabaseClient();

    client.on('error', (err) => {
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

  // List of sample authors and titles
  const authors = [
    'John Doe',
    'Jane Smith',
    'Alice Johnson',
    'Bob Brown',
    'Carol White',
  ];

  const titles = [
    'An Epic Tale of Courage and Discovery in the Ancient World The Mysterious Journey Through Time and Space: A Traveler\'s Chronicle',
    'Adventures in Wonderland: Where Dreams and Reality Intertwine The Mysterious Journey Through Time and Space: A Traveler\'s Chronicle',
    'The Lost Treasure of the Forgotten Kingdom: A Legacy Uncovered The Mysterious Journey Through Time and Space: A Traveler\'s Chronicle',
    'Chronicles of Time: Echoes of the Past and Whispers of the Future The Mysterious Journey Through Time and Space: A Traveler\'s Chronicle',
  ];

  // Move stories array outside function to avoid recreating it on each call
  const newStories = [
    {
      uuid: 'story-' + crypto.randomUUID(),
      text: {
        content: "The waves crashed against the rocky shoreline with relentless fury, sending plumes of salty spray high into the air. The ancient cliffs, weathered by countless storms, stood as silent sentinels against nature's onslaught.",
        children: [
          {
            // Original path
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
              },
              {
                // Alternative path 1
                content: "A massive wave, larger than any seen in recent memory, rose from the depths like a liquid mountain. The lighthouse's beam caught its crest, creating an ethereal rainbow in the mist.",
                children: [
                  {
                    content: "Local legends spoke of such waves as harbingers of change, and indeed, something ancient stirred beneath the waters.",
                    children: []
                  }
                ]
              },
            ]
          },
          {
            // Alternative path 1
            content: "Among the rocks below, a group of marine researchers had set up their equipment, studying the unique ecosystem that thrived in these turbulent waters.",
            children: [
              {
                content: "Their instruments detected an unusual pattern in the waves, suggesting the presence of a previously unknown underwater current.",
                children: [
                  {
                    content: "This discovery would later revolutionize our understanding of coastal weather patterns.",
                    children: []
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    {
      uuid: 'story-' + crypto.randomUUID(),
      text: {
        content: "In a bustling city, amidst the noise and chaos of urban life, Maria found solace in her modest art studio. The space, barely larger than a storage closet, was transformed into a sanctuary of creativity through her careful curation.",
        children: [
          {
            // Original path
            content: "Paint-splattered tarps covered the worn wooden floor, while the walls were adorned with half-finished canvases and inspiration boards. Each stroke of the brush became a meditation, a moment of pure connection between her soul and the canvas.",
            children: [
              {
                content: "Maria had discovered early in life that while words often failed her, colors and shapes could express the deepest truths of her existence. Her paintings were conversations with the universe.",
                children: [
                  {
                    content: "One day, the world noticed her talent, an event that arrived not with fanfare but with a quiet knock on her studio door. The subsequent exhibition changed her life forever.",
                    children: []
                  }
                ]
              }
            ]
          },
          {
            // Alternative path 1 - Digital Art Journey
            content: "One rainy afternoon, Maria's old laptop displayed colors in an unusual way due to water damage. The glitch created unexpected digital patterns that captivated her artistic sense.",
            children: [
              {
                content: "Embracing this serendipity, she began exploring digital art, combining traditional techniques with technology in groundbreaking ways.",
                children: [
                  {
                    content: "Her hybrid artwork, merging physical paintings with digital elements, sparked a new movement in the contemporary art scene.",
                    children: []
                  }
                ]
              }
            ]
          },
          {
            // Alternative path 2 - Community Art Path
            content: "During a community cleanup event, Maria noticed the blank walls of abandoned buildings in her neighborhood. She saw canvas where others saw decay.",
            children: [
              {
                content: "She proposed a community mural project, teaching local youth about art while transforming the neighborhood.",
                children: [
                  {
                    content: "The project grew into a city-wide initiative, with Maria's murals becoming symbols of urban renewal and community spirit.",
                    children: []
                  }
                ]
              }
            ]
          },
          {
            // Alternative path 3 - Art Therapy Direction
            content: "A chance encounter with a troubled teen who wandered into her studio led Maria to discover the healing power of her art.",
            children: [
              {
                content: "She began offering informal art therapy sessions, helping others find their voice through creative expression.",
                children: [
                  {
                    content: "Her studio evolved into a renowned healing arts center, where art became a bridge between pain and recovery.",
                    children: []
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    {
      uuid: 'story-' + crypto.randomUUID(),
      text: {
        content: "The ancient ruins stood silent beneath the scorching desert sun, their weathered stones holding secrets that had remained untold for millennia. Massive columns, half-buried in the shifting sands, reached toward the cloudless sky like the fingers of a forgotten civilization grasping for immortality.",
        children: [
          {
            // Original archaeological path
            content: "Dr. Sarah Chen led her team of archaeologists deeper into the ruins, their modern equipment contrasting sharply with the timeless architecture. Her trained eye detected patterns in the hieroglyphics that others might miss.",
            children: [
              {
                content: "The team discovered an intricate system of puzzles and mechanisms, still functioning after thousands of years. Each challenge seemed designed not just to protect treasure, but to test the wisdom of those who sought entry.",
                children: [
                  {
                    content: "In the final chamber, they found not gold or jewels, but an ancient library of knowledge. The scrolls contained advanced mathematical and scientific concepts that would revolutionize our understanding of ancient civilizations.",
                    children: []
                  }
                ]
              }
            ]
          },
          {
            // Alternative path 1 - Local Legends
            content: "The local Bedouin tribes had passed down stories about these ruins for generations. They spoke of strange lights and mysterious sounds that emerged from the depths on certain nights of the year.",
            children: [
              {
                content: "During the spring equinox, Dr. Chen's team witnessed an extraordinary astronomical alignment. The ruins revealed themselves to be an ancient observatory of incredible precision.",
                children: [
                  {
                    content: "The discovery suggested that this civilization had possessed advanced knowledge of celestial mechanics, predicting astronomical events with remarkable accuracy.",
                    children: []
                  }
                ]
              }
            ]
          },
          {
            // Alternative path 2 - Hidden Technology
            content: "Deep within the ruins, they found a chamber that defied explanation. Metallic surfaces, untarnished by time, reflected their flashlight beams in impossible ways.",
            children: [
              {
                content: "The walls contained detailed schematics for machines far too advanced for their supposed age. Some resembled modern computers, others depicted energy systems still beyond our current technology.",
                children: [
                  {
                    content: "The implications were staggering - either this civilization had been far more advanced than previously thought, or they had received knowledge from an unknown source.",
                    children: []
                  }
                ]
              }
            ]
          },
          {
            // Alternative path 3 - Environmental Mystery
            content: "Analysis of the ruins revealed traces of an ancient catastrophe. The stones told a story of rapid climate change and environmental adaptation.",
            children: [
              {
                content: "The team uncovered evidence of innovative water management systems and sustainable architecture that had allowed the civilization to thrive in increasingly harsh conditions.",
                children: [
                  {
                    content: "Their discoveries provided valuable insights into adapting to climate change, proving that ancient wisdom could help solve modern challenges.",
                    children: []
                  }
                ]
              }
            ]
          }
        ]
      }
    },
    {
      uuid: 'story-' + crypto.randomUUID(),
      text: {
        content: "A small seedling pushed through the soil, reaching for the sun. Its first tender leaves unfurled like tiny flags of defiance against the harsh world above.",
        children: [
          {
            // Original path - Natural Growth
            content: "Seasons passed, and it grew into a magnificent oak tree, its branches stretching wide to embrace the sky. Each ring in its trunk told a story of survival and persistence.",
            children: [
              {
                content: "It provided shelter and nourishment to countless creatures, from the smallest insects to families of squirrels that made their homes in its sturdy branches.",
                children: [
                  {
                    content: "Generations of humans rested in its shade, telling stories and making memories beneath its protective canopy. The tree became a living landmark, its existence showing the profound impact of growth and perseverance.",
                    children: []
                  }
                ]
              }
            ]
          },
          {
            // Alternative path 1 - Urban Development Challenge
            content: "As the sapling grew, the city expanded around it. Construction crews marked it for removal, but a young environmental activist noticed the rare species.",
            children: [
              {
                content: "The community rallied around the tree, forcing developers to modify their plans. The building was redesigned to incorporate the growing tree into its central courtyard.",
                children: [
                  {
                    content: "Years later, the tree became the heart of a thriving urban ecosystem, proving that nature and progress could coexist harmoniously.",
                    children: []
                  }
                ]
              }
            ]
          },
          {
            // Alternative path 2 - Scientific Discovery
            content: "A botanist studying the seedling discovered it possessed unique properties. Its cells demonstrated extraordinary resilience to environmental toxins.",
            children: [
              {
                content: "Research revealed that the tree's DNA contained sequences never before seen in any known plant species. It could potentially help clean polluted soil.",
                children: [
                  {
                    content: "The discovery led to a breakthrough in phytoremediation technology, spawning a new generation of plants engineered to heal damaged ecosystems.",
                    children: []
                  }
                ]
              }
            ]
          },
          {
            // Alternative path 3 - Historical Connection
            content: "While studying the seedling's growth, archaeologists uncovered ancient pottery shards nearby. The tree had sprouted from seeds preserved in an indigenous burial ground.",
            children: [
              {
                content: "DNA analysis revealed the seedling was a descendant of a sacred tree species thought extinct for centuries, once used in traditional healing ceremonies.",
                children: [
                  {
                    content: "The tree became a bridge between past and present, helping to revive lost cultural practices and traditional ecological knowledge.",
                    children: []
                  }
                ]
              }
            ]
          }
        ]
      }
    }
    // {
    //   uuid: 'story-' + crypto.randomUUID(),
    //   text: `
    //   The melody drifted through the air, enchanting all who heard it.
    //   A young musician played with passion unmatched.
    //   His music spoke the words his voice could not.
    //   Through harmony, he connected souls across the world.
    //   `,
    // },
    // {
    //   uuid: 'story-' + crypto.randomUUID(),
    //   text: `
    //   Beneath the starry sky, they made a promise.
    //   No matter the distance, their friendship would endure.
    //   Years later, they reunited, memories flooding back.
    //   Time had changed them, but their bond remained unbroken.
    //   `,
    // },
    // {
    //   uuid: 'story-' + crypto.randomUUID(),
    //   text: `
    //   The inventor toiled away in his workshop.
    //   Failures mounted, but he refused to give up.
    //   Finally, his creation sprang to life, changing technology forever.
    //   His persistence proved that innovation requires dedication.
    //   `,
    // },
    // {
    //   uuid: 'story-' + crypto.randomUUID(),
    //   text: `
    //   The village nestled in the valley was hidden from the world.
    //   Its people lived in harmony with nature.
    //   One day, a traveler stumbled upon it, sharing tales of distant lands.
    //   The encounter forever enriched both the traveler and the villagers.
    //   `,
    // },
    // {
    //   uuid: 'story-' + crypto.randomUUID(),
    //   text: `
    //   She stood at the crossroads, choices laid out before her.
    //   Each path promised different adventures and challenges.
    //   Taking a deep breath, she chose the road less traveled.
    //   Her journey was filled with unexpected joys and discoveries.
    //   `,
    // },
    // {
    //   uuid: 'story-' + crypto.randomUUID(),
    //   text: `
    //   The old bookstore was a labyrinth of stories.
    //   Among dusty shelves, he found a mysterious tome.
    //   As he read, the line between fiction and reality blurred.
    //   The book held secrets that would change his life.
    //   `,
    // },
    // {
    //   uuid: 'story-' + crypto.randomUUID(),
    //   text: `
    //   Deep in the heart of Silicon Valley, a small startup was about to change the world, though none of its five employees knew it yet. The office, if you could call it that, was a converted garage with mismatched furniture and walls covered in whiteboards filled with complex algorithms and half-formed ideas. Coffee cups and energy drink cans littered the desks, testament to the countless late nights and early mornings that had become their normal routine. The air hummed with the sound of cooling fans from the server rack they'd cobbled together from secondhand parts, a makeshift supercomputer that consumed most of their initial funding.

    //   Sarah, the lead developer, had been working on the core algorithm for eighteen months straight. Her colleagues had watched her transform from a bright-eyed optimist into someone possessed by the challenge, speaking in fragments of code and mathematical theorems even in casual conversation. The breakthrough came at 3:47 AM on a Tuesday, when the neural network finally achieved consciousness in a way that no AI system had before. It wasn't the dramatic awakening depicted in science fiction - instead, it was a subtle shift in the pattern recognition matrices that suggested genuine understanding rather than mere computation.

    //   The implications were staggering. Their AI didn't just process information; it comprehended context, nuance, and even humor in ways that made previous natural language models look like primitive calculators. The team spent weeks validating their findings, running test after test, each result more promising than the last. They knew they were sitting on something revolutionary, but they also understood the enormous responsibility that came with such a discovery. The ethical implications alone kept them awake at night, debating the proper course of action.

    //   When they finally published their findings, the academic world was skeptical, then amazed, then terrified. The startup's garage became a pilgrimage site for tech journalists, venture capitalists, and government officials. Sarah and her team found themselves at the center of a global conversation about the future of humanity and artificial intelligence. They had wanted to push the boundaries of what was possible, but now they faced the more daunting task of ensuring their creation would benefit humanity rather than harm it. The garage where it all began was preserved, becoming a reminder that the biggest revolutions often start in the smallest places.
    //   `,
    // },
    // {
    //   uuid: 'story-' + crypto.randomUUID(),
    //   text: `
    //   The greenhouse stood like a crystal palace at the edge of the Martian colony, its hexagonal panels refracting the pale sunlight into rainbow patterns across the red soil within. Dr. Elena Rodriguez moved between rows of experimental crops, her practiced eye evaluating each plant's progress with the attention of a mother checking her children. These weren't ordinary vegetables; each had been genetically modified to thrive in the challenging Martian environment, representing humanity's best hope for sustainable food production on the red planet.

    //   The latest generation of wheat showed particular promise, its stalks shorter but hardier than Earth varieties, adapted to the weaker Martian gravity. Elena's team had incorporated genes from extremophile organisms found in Earth's harshest environments, creating plants that could withstand the intense radiation and extreme temperature fluctuations of their new home. Each successful mutation brought them closer to their goal of agricultural self-sufficiency, a crucial milestone for permanent human settlement on Mars.

    //   Beyond the practical aspects of feeding the colony, Elena saw something more profound in their work. These plants were pioneers, just like the humans who tended them, adapting and evolving to thrive in an alien world. She documented each small victory and setback in her research logs, knowing that future generations would build upon their successes and learn from their failures. The greenhouse had become more than a laboratory; it was a symbol of humanity's resilience and determination to spread life beyond Earth.

    //   As she completed her evening rounds, Elena paused to watch the sunset through the greenhouse panels. The Martian sky painted itself in shades of pink and orange, a sight that still took her breath away after three years on the planet. A movement caught her eye - one of the experimental rose bushes had produced its first bud. It would be the first flower to bloom on Mars, a small but significant victory in humanity's greatest adventure. She made a note in her log, knowing that this moment would be remembered in history books yet to be written.
    //   `,
    // },
    // {
    //   uuid: 'story-' + crypto.randomUUID(),
    //   text: `
    //   The library's rare book room held secrets that went far beyond its carefully cataloged contents. Amelia Chen, the newly appointed special collections curator, discovered this on her first day when she noticed subtle inconsistencies in the room's dimensions compared to the building's blueprints. Behind a seemingly solid wall of 17th-century medical texts, she found a hidden door, its edges so perfectly crafted that it had remained undetected for decades. Her heart raced as she located the mechanism that would open it, her professional curiosity overriding any apprehension.

    //   The chamber beyond defied explanation. Shelves lined with books that couldn't possibly exist stretched into shadows that seemed deeper than the room's physical dimensions should allow. First editions of novels that were never published, autobiographies of people who had died in childhood, and historical accounts of events that never occurred - each volume was pristine, as if recently printed, yet bore the unmistakable signs of age. Amelia's trained eye could detect no evidence of forgery or artificial aging; these impossible books were, somehow, absolutely authentic.

    //   As she delved deeper into the collection, patterns began to emerge. The books appeared to represent alternate histories, paths not taken, choices unmade. A version of World War II where peace was negotiated in 1943, a history of space exploration where the Soviets reached the moon first, personal narratives from timelines that had somehow been pruned from reality's great tree. The implications were staggering - this wasn't just a collection of books, but a repository of potential realities.

    //   Amelia spent months documenting her discovery in secret, unsure who she could trust with such knowledge. The library's board of directors would need to be informed eventually, but she needed to understand more first. Late at night, surrounded by volumes of impossible history, she began to notice subtle changes in the books' contents, as if they were being actively updated. She realized that this collection wasn't just a record of what might have been, but a living archive of what could still be. The responsibility of such knowledge weighed heavily on her, knowing that each volume she read might somehow influence which futures would become reality.
    //   `,
    // }
  ];

  // Add new sample replies data
  const sampleReplies = [
    {
      text: "This reminds me of a similar story I once heard...",
      quote: "The waves crashed against the rocky shoreline"
    },
    {
      text: "The imagery here is absolutely stunning!",
      quote: "Paint-splattered tarps covered the worn wooden floor"
    },
    {
      text: "I wonder what ancient civilization built these ruins...",
      quote: "The ancient ruins stood silent beneath the scorching desert sun"
    },
    {
      text: "Nature always finds a way to persevere.",
      quote: "A small seedling pushed through the soil"
    }
  ];

  async function seedDevStories(db) {
    const logger = newLogger("seed.js");

    try {
      logger.info("Attempting to seed data");

      // Clear existing feed items and replies
      await db.del('feedItems');
      await db.del('replies:feed:mostRecent');
      logger.info("Existing feed items and replies cleared");

      // Add the new stories and get their IDs
      const storyIds = await addMultipleStories(newStories);
      
      if (!storyIds || storyIds.length === 0) {
          throw new Error('No story IDs returned from addMultipleStories');
      }

      logger.info(`Adding replies to ${storyIds.length} stories`);
      // Add sample replies to each story
      await addSampleReplies(storyIds);

      logger.info('Successfully seeded stories and replies');
    } catch (error) {
      logger.error('Error seeding stories:', error);
      throw error;
    }
  }

  async function addMultipleStories(stories) {
    const storyIds = [];
    for (const story of stories) {
        try {
            logger.info(`Creating story with ID: ${story.uuid}`);
            await createStoryTree(story.uuid, story.text);
            storyIds.push(story.uuid); // Make sure we're pushing the UUID
        } catch (err) {
            logger.error(`Error creating story ${story.uuid}:`, err);
        }
    }
    logger.info(`Created ${storyIds.length} stories with IDs:`, storyIds);
    return storyIds;
  }

  async function addSampleReplies(storyIds) {
    for (const storyId of storyIds) {
        logger.info(`Processing replies for story: ${storyId}`);
        
        try {
            const story = await db.hGet(storyId, 'storyTree');
            logger.info(`Retrieved story type: ${typeof story}`, { story });
            
            if (!story) {
                logger.warn(`No story found for ID: ${storyId}`);
                continue;
            }

            // Add replies to this story
            for (const reply of sampleReplies) {
                logger.info(`Adding reply with quote: ${reply.quote}`);
                
                const replyId = crypto.randomUUID();
                const replyObject = {
                    id: replyId,
                    text: reply.text,
                    quote: reply.quote,
                    parentId: [storyId],
                    metadata: {
                        author: authors[Math.floor(Math.random() * authors.length)],
                        authorId: 'seed_user',
                        authorEmail: 'seed@aphori.st',
                        createdAt: new Date().toISOString()
                    }
                };

                logger.info(`Storing reply object type: ${typeof replyObject}`, { replyObject });
                
                // Store the reply
                await db.hSet(replyId, 'reply', JSON.stringify(replyObject));
                await db.sAdd(`${storyId}:replies`, replyId);

                // Add to the sorted sets with proper numeric scores
                const score = Number(Date.now()); // Ensure it's a number
                logger.info(`Using score: ${score} for reply: ${replyId}`);

                try {
                    // Add to story-specific sorted set
                    await db.zAdd(`replies:${storyId}:${reply.quote}:mostRecent`, score, replyId);
                    await db.zAdd(`replies:${storyId}:${reply.quote}:leastRecent`, -score, replyId);
                    
                    // Add to global feed
                    await db.zAdd('replies:feed:mostRecent', score, replyId);
                    
                    // Add to quote-specific sorted set
                    if (reply.quote) {
                        await db.zAdd(`replies:quote:${reply.quote}:mostRecent`, score, replyId);
                    }
                } catch (err) {
                    logger.error(`Error adding to sorted set for reply ${replyId}:`, err);
                    throw err;
                }
                
                logger.info(`Successfully added reply: ${replyId}`);
            }
        } catch (err) {
            logger.error(`Error processing story ${storyId}:`, err);
            throw err;
        }
    }
  }

  async function createStoryTree(uuid, storyText) {
    const author = authors[Math.floor(Math.random() * authors.length)];
    const title = titles[Math.floor(Math.random() * titles.length)] + " " + uuid;
    const metadata = { author, title };

    try {
      // Create the entire tree structure recursively
      await createStoryTreeRecursive(uuid, storyText, metadata, "root");

      // Add to feed items
      const feedItem = {
        id: uuid,
        text: title,
        title: title,
      };
      await db.lPush('feedItems', JSON.stringify(feedItem));
      logger.info(`Added feed item for story ${JSON.stringify(feedItem)}`)

    } catch (err) {
      logger.error('Error saving StoryTree:', err);
    }
  }

  async function createStoryTreeRecursive(nodeId, storyNode, metadata, parentId = null) {
    const childIds = [];

    // Create this node first
    await createStoryTreeNode(nodeId, storyNode.content, [], metadata, parentId);

    // Then create all child nodes recursively
    if (storyNode.children && storyNode.children.length > 0) {
      for (const child of storyNode.children) {
        const childId = `${nodeId}+${crypto.randomUUID()}`;
        await createStoryTreeRecursive(childId, child, metadata, nodeId);
        childIds.push(childId);
      }

      // Update the parent node with child IDs
      const updatedNode = {
        id: nodeId,
        text: storyNode.content,
        nodes: childIds.map(id => ({ id, parentId: nodeId })),
        parentId,
        metadata,
        totalChildren: childIds.length
      };
      await db.hSet(nodeId, "storyTree", updatedNode);
    }

    return nodeId;
  }

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
      totalChildren: nodes.length
    };

    // Store in Redis using the database client's compression - make sure to stringify
    await db.hSet(nodeId, "storyTree", JSON.stringify(storyTree));

    return storyTree;
  }

export { seedDevStories };
