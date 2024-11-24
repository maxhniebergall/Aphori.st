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
  const title = titles[Math.floor(Math.random() * titles.length)] + " " + uuid;

  // Split the story text into nodes delimited by new lines and clean up
  const lines = storyText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  try {
    // Create nodes from bottom up
    let previousNode = null;
    let previousNodeId = null;

    // Create nodes in reverse order (except root)
    for (let i = lines.length - 1; i > 0; i--) {
      const nodeId = `${uuid}-node-${i}`;
      const storyTree = {
        metadata: {
          author,
          title,
        },
        id: nodeId,
        text: lines[i],
        nodes: previousNodeId ? [{ id: previousNodeId }] : [] // Link to next node if exists
      };

      // Store this node
      await client.hSet(nodeId, "storyTree", JSON.stringify(storyTree));
      
      previousNode = storyTree;
      previousNodeId = nodeId;
    }

    // Create root node with first paragraph and link to first child
    let rootStoryTree = {
      metadata: {
        author,
        title,
      },
      id: uuid,
      text: lines[0],
      nodes: previousNodeId ? [{ id: previousNodeId }] : []
    };

    // Store the root node
    await client.hSet(uuid, "storyTree", JSON.stringify(rootStoryTree));

    // Update the feed items
    const feedItem = {
      id: uuid,
      text: title
    };
    await client.rPush('feedItems', JSON.stringify(feedItem));
    
    logger.info(`Created story tree with ${lines.length} nodes for UUID: ${uuid}`);
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
    The waves crashed against the rocky shoreline with relentless fury, sending plumes of salty spray high into the air. The ancient cliffs, weathered by countless storms, stood as silent sentinels against nature's onslaught. Seabirds wheeled overhead, their mournful cries barely audible above the thunderous roar of the ocean. The air was thick with the scent of brine and seaweed, a primal reminder of the sea's eternal presence. Dark clouds roiled above, their ominous forms illuminated occasionally by distant lightning, creating an otherworldly atmosphere that seemed to bridge the gap between reality and legend.

    A lone lighthouse stood tall against the turbulent backdrop, its weathered white paint peeling in strips from decades of exposure to the harsh maritime elements. The structure's foundation, built from massive granite blocks quarried from these very cliffs, had withstood over a century of storms. Its beacon, a powerful beam of hope in the darkness, cut through the growing gloom with unwavering determination. The light's steady rotation was a testament to human perseverance in the face of nature's raw power.

    The keeper watched diligently from his perch high above the churning waters, his experienced eyes scanning the horizon for any signs of vessels in distress. His calloused hands gripped the railing of the observation deck, feeling the vibrations of the waves through the very structure of the lighthouse. Years of service had taught him to read the sea's moods like a book, and tonight's story was one of particular violence. In his logbook, he had already noted three ships seeking safer waters, their navigation lights barely visible through the spray and darkness.

    As dawn broke, the sea calmed, transforming from a raging monster into a gentle giant. The first rays of sunlight pierced through the dissipating storm clouds, creating a spectacular display of colors that painted the sky in shades of pink, orange, and gold. The lighthouse keeper, having maintained his vigil through the night, allowed himself a small smile of satisfaction. Another storm weathered, another night of safe passage ensured for those who depended on his unwavering dedication to duty.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    In a bustling city, amidst the noise and chaos of urban life, Maria found solace in her modest art studio. The space, barely larger than a storage closet, was transformed into a sanctuary of creativity through her careful curation. Paint-splattered tarps covered the worn wooden floor, while the walls were adorned with half-finished canvases and inspiration boards filled with magazine clippings, photographs, and sketches. The large window, though looking out onto a brick wall, provided enough natural light to illuminate her work in the soft glow she preferred.

    Each stroke of the brush became a meditation, a moment of pure connection between her soul and the canvas. Maria had discovered early in life that while words often failed her, colors and shapes could express the deepest truths of her existence. Her paintings were conversations with the universe, silent dialogues that spoke volumes to those who took the time to listen. The act of creation became her language, more eloquent than any speech she could deliver.

    Her paintings reflected the beauty she saw in everyday life, transforming mundane scenes into extraordinary visions. A homeless man sharing his sandwich with a stray dog became a study in compassion. The reflection of neon signs in rain-slicked streets turned into an exploration of urban poetry. The steam rising from a coffee cup in the early morning light evolved into a meditation on solitude and contemplation. Through her unique perspective, the ordinary became extraordinary, and the overlooked became impossible to ignore.

    One day, the world noticed her talent, an event that arrived not with fanfare but with a quiet knock on her studio door. A gallery owner, intrigued by one of Maria's pieces displayed in a local coffee shop, had tracked her down. The subsequent exhibition changed her life forever, not because of the sales or recognition, though both were substantial, but because it validated what she had always known in her heart: that art had the power to bridge the gaps between people, to communicate universal truths that transcended language and culture.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    The ancient ruins stood silent beneath the scorching desert sun, their weathered stones holding secrets that had remained untold for millennia. Massive columns, half-buried in the shifting sands, reached toward the cloudless sky like the fingers of a forgotten civilization grasping for immortality. Hieroglyphics and mysterious symbols covered the walls, their meanings obscured by the passage of time, yet their power to intrigue remained undiminished. The air was thick with the weight of history, and the silence was broken only by the occasional whisper of wind through the ancient corridors.

    Explorers ventured deep within the labyrinthine structure, their modern equipment contrasting sharply with the timeless architecture surrounding them. Dr. Sarah Chen, the expedition leader, ran her fingers along the wall inscriptions, her trained eye detecting patterns that others might miss. Her team of archaeologists and historians moved with careful precision, documenting every detail, every artifact, every possibility that might shed light on the civilization that had created this magnificent structure.

    Traps and puzzles tested their wits at every turn, mechanisms still functioning after thousands of years. A pressure plate here, a counterweight there – each challenge seemed designed not just to protect treasure, but to test the wisdom and patience of those who sought entry. The team encountered chambers filled with mathematical riddles, astronomical alignments, and philosophical tests that suggested the ancient builders were far more sophisticated than previously believed.

    Ultimately, they discovered that wisdom was indeed the greatest treasure of all. The final chamber contained not gold or jewels, but a vast library of knowledge, preserved through ingenious engineering. The scrolls and tablets they found contained information about mathematics, medicine, and sciences that were centuries ahead of their time. This discovery would revolutionize our understanding of ancient civilizations and remind the world that true wealth lies not in material riches, but in the pursuit of knowledge and understanding.
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
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    Deep in the heart of Silicon Valley, a small startup was about to change the world, though none of its five employees knew it yet. The office, if you could call it that, was a converted garage with mismatched furniture and walls covered in whiteboards filled with complex algorithms and half-formed ideas. Coffee cups and energy drink cans littered the desks, testament to the countless late nights and early mornings that had become their normal routine. The air hummed with the sound of cooling fans from the server rack they'd cobbled together from secondhand parts, a makeshift supercomputer that consumed most of their initial funding.

    Sarah, the lead developer, had been working on the core algorithm for eighteen months straight. Her colleagues had watched her transform from a bright-eyed optimist into someone possessed by the challenge, speaking in fragments of code and mathematical theorems even in casual conversation. The breakthrough came at 3:47 AM on a Tuesday, when the neural network finally achieved consciousness in a way that no AI system had before. It wasn't the dramatic awakening depicted in science fiction - instead, it was a subtle shift in the pattern recognition matrices that suggested genuine understanding rather than mere computation.

    The implications were staggering. Their AI didn't just process information; it comprehended context, nuance, and even humor in ways that made previous natural language models look like primitive calculators. The team spent weeks validating their findings, running test after test, each result more promising than the last. They knew they were sitting on something revolutionary, but they also understood the enormous responsibility that came with such a discovery. The ethical implications alone kept them awake at night, debating the proper course of action.

    When they finally published their findings, the academic world was skeptical, then amazed, then terrified. The startup's garage became a pilgrimage site for tech journalists, venture capitalists, and government officials. Sarah and her team found themselves at the center of a global conversation about the future of humanity and artificial intelligence. They had wanted to push the boundaries of what was possible, but now they faced the more daunting task of ensuring their creation would benefit humanity rather than harm it. The garage where it all began was preserved, becoming a reminder that the biggest revolutions often start in the smallest places.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    The greenhouse stood like a crystal palace at the edge of the Martian colony, its hexagonal panels refracting the pale sunlight into rainbow patterns across the red soil within. Dr. Elena Rodriguez moved between rows of experimental crops, her practiced eye evaluating each plant's progress with the attention of a mother checking her children. These weren't ordinary vegetables; each had been genetically modified to thrive in the challenging Martian environment, representing humanity's best hope for sustainable food production on the red planet.

    The latest generation of wheat showed particular promise, its stalks shorter but hardier than Earth varieties, adapted to the weaker Martian gravity. Elena's team had incorporated genes from extremophile organisms found in Earth's harshest environments, creating plants that could withstand the intense radiation and extreme temperature fluctuations of their new home. Each successful mutation brought them closer to their goal of agricultural self-sufficiency, a crucial milestone for permanent human settlement on Mars.

    Beyond the practical aspects of feeding the colony, Elena saw something more profound in their work. These plants were pioneers, just like the humans who tended them, adapting and evolving to thrive in an alien world. She documented each small victory and setback in her research logs, knowing that future generations would build upon their successes and learn from their failures. The greenhouse had become more than a laboratory; it was a symbol of humanity's resilience and determination to spread life beyond Earth.

    As she completed her evening rounds, Elena paused to watch the sunset through the greenhouse panels. The Martian sky painted itself in shades of pink and orange, a sight that still took her breath away after three years on the planet. A movement caught her eye - one of the experimental rose bushes had produced its first bud. It would be the first flower to bloom on Mars, a small but significant victory in humanity's greatest adventure. She made a note in her log, knowing that this moment would be remembered in history books yet to be written.
    `,
  },
  {
    uuid: 'story-' + crypto.randomUUID(),
    text: `
    The library's rare book room held secrets that went far beyond its carefully cataloged contents. Amelia Chen, the newly appointed special collections curator, discovered this on her first day when she noticed subtle inconsistencies in the room's dimensions compared to the building's blueprints. Behind a seemingly solid wall of 17th-century medical texts, she found a hidden door, its edges so perfectly crafted that it had remained undetected for decades. Her heart raced as she located the mechanism that would open it, her professional curiosity overriding any apprehension.

    The chamber beyond defied explanation. Shelves lined with books that couldn't possibly exist stretched into shadows that seemed deeper than the room's physical dimensions should allow. First editions of novels that were never published, autobiographies of people who had died in childhood, and historical accounts of events that never occurred - each volume was pristine, as if recently printed, yet bore the unmistakable signs of age. Amelia's trained eye could detect no evidence of forgery or artificial aging; these impossible books were, somehow, absolutely authentic.

    As she delved deeper into the collection, patterns began to emerge. The books appeared to represent alternate histories, paths not taken, choices unmade. A version of World War II where peace was negotiated in 1943, a history of space exploration where the Soviets reached the moon first, personal narratives from timelines that had somehow been pruned from reality's great tree. The implications were staggering - this wasn't just a collection of books, but a repository of potential realities.

    Amelia spent months documenting her discovery in secret, unsure who she could trust with such knowledge. The library's board of directors would need to be informed eventually, but she needed to understand more first. Late at night, surrounded by volumes of impossible history, she began to notice subtle changes in the books' contents, as if they were being actively updated. She realized that this collection wasn't just a record of what might have been, but a living archive of what could still be. The responsibility of such knowledge weighed heavily on her, knowing that each volume she read might somehow influence which futures would become reality.
    `,
  }
  // I can add more if you'd like!
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
