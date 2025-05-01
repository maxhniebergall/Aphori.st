/*
Requirements:
- Seed script must clear existing feed items before adding new ones
- Each story must have a unique v7 (timestamp sortable) UUID
- Stories must be stored in Redis with proper metadata
- Must use backend server's database client for compression support
- Must be exportable as a function for programmatic seeding
- Must maintain idempotency when run multiple times
*/

import { createClient, RedisClientType } from 'redis';
import { uuidv7obj } from "uuidv7";
import { Uuid25 } from "uuid25";
import newLogger from './logger.js';
import { createDatabaseClient } from './db/index.js';
import { DatabaseClientInterface } from './db/DatabaseClientInterface.js';
import { FeedItem, Post, Reply, Quote } from './types/index.js';
import { getQuoteKey } from './utils/quoteUtils.js';
import { randomInt } from 'crypto';

const logger = newLogger("seed.ts");


interface StoryContent {
    content: string;
}

let db: DatabaseClientInterface;
// let client: RedisClientType; // Removed direct Redis client declaration

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

/**
 * Seeds the database with initial development stories.
 * Clears existing feed items and story IDs before seeding.
 * Uses the provided database client instance.
 * @param dbClient The database client instance to use.
 * @throws {Error} If clearing old data or creating initial stories fails.
 *                 (Handled - By Design: Logs error and re-throws to stop seeding).
 */
async function seedDevStories(dbClient: DatabaseClientInterface): Promise<void> {
    try {
        db = dbClient; // Use the passed-in dbClient
        logger.info("Attempting to seed data");

        // Clear existing feed items and story IDs using the db client
        // Note: This might be redundant if the block above already cleared them,
        // but can be kept for safety or if seedDevStories is called independently.
        try {
            await db.del('feedItems');
            await db.del('allPostTreeIds');
            logger.info("Existing feed items cleared within seedDevStories using db client");
        } catch (err) {
            logger.error('Failed to delete existing keys within seedDevStories:', err);
        }

        const storyIds: string[] = [];
        const storyContents: string[] = [];

        // Create each story
        for (const story of sampleStories) {
            const uuid = Uuid25.fromBytes(uuidv7obj().bytes).value;
            storyIds.push(uuid);
            storyContents.push(story.content);
            
            // Create the story following Post schema structure
            const formattedStory: Post = {
                id: uuid,
                content: story.content,
                authorId: 'seed_user',
                createdAt: new Date().toISOString(),
            };

            // Store in Redis, ensuring consistency with create/get endpoints
            // Use field key 'postTree' and store stringified JSON
            await db.hSet(uuid, 'postTree', JSON.stringify(formattedStory));
            await db.lPush('allPostTreeIds', uuid);

            // Add to feed items (only root-level posts go to feed)
            const feedItem = {
                id: uuid,
                text: formattedStory.content,
                authorId: formattedStory.authorId,
                createdAt: formattedStory.createdAt
            } as FeedItem;
            // Ensure feed items are stored as strings, consistent with server.ts
            await db.lPush('feedItems', JSON.stringify(feedItem));
            logger.info(`Added feed item for story ${JSON.stringify(feedItem)}`);

            logger.info(`Created new story with UUID: ${uuid}`);
        }
        await seedTestReplies(storyIds, storyContents);
        logger.info("Successfully seeded dev stories.");
    } catch (error) {
        // Handled - By Design: Catches errors during initial story creation loop.
        // Logs the error and re-throws to stop the entire seeding process if base stories fail.
        logger.error('Error seeding dev stories:', error);
        throw error;
    }
}

/**
 * Calculates the start and end character indices for a selection of words in a text.
 * @param text The source text.
 * @param startWordIndex The index of the first word in the selection.
 * @param endWordIndex The index *after* the last word in the selection.
 * @returns An object with start/end character indices and the extracted excerpt, or null if indices are invalid.
 */
function calculateCharIndices(text: string, startWordIndex: number, endWordIndex: number): { start: number; end: number; excerpt: string } | null {
    const words = text.split(/\s+/); // Split by whitespace
    if (startWordIndex < 0 || endWordIndex > words.length || startWordIndex >= endWordIndex || words.length === 0) {
        return null; // Invalid indices or empty text
    }

    let currentPos = 0;
    let startChar = -1;
    let endChar = -1;
    let firstWordStartIndex = -1;

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const wordStart = text.indexOf(word, currentPos); // Find word start index from current position
        if (wordStart === -1) {
            // Should not happen if split is correct, but safeguard
            logger.error(`Word '${word}' not found in text starting from position ${currentPos}`);
            return null;
        }
        const wordEnd = wordStart + word.length;

        if (i === startWordIndex) {
            startChar = wordStart;
        }
        // We need the end index *after* the last character of the last selected word
        if (i === endWordIndex - 1) {
            endChar = wordEnd;
        }

        currentPos = wordEnd; // Update current position for next search
    }

    // If selection goes to the very end of the text
    if (endWordIndex === words.length && startChar !== -1) {
         endChar = text.length;
    }

    if (startChar === -1 || endChar === -1) {
        logger.warn(`Could not determine valid character indices for word range ${startWordIndex}-${endWordIndex}`);
        return null;
    }

    const excerptText = text.substring(startChar, endChar);

    return { start: startChar, end: endChar, excerpt: excerptText };
}

/**
 * Seeds test replies for the given story IDs.
 * Creates multiple levels of nested replies with generated quotes.
 * @param storyIds Array of parent story IDs.
 * @param storyContents Array of corresponding story content strings.
 * @throws {Error} If storing replies or updating indices fails.
 *                 (Handled - By Design: Logs error and re-throws, caught by seedDevStories).
 */
async function seedTestReplies(storyIds: string[], storyContents: string[]): Promise<void> {
    try {
        logger.info("Seeding test replies...");
        for (const storyId of storyIds) {
            const storyContent = storyContents[storyIds.indexOf(storyId)];
            const storyWords = storyContent.split(/\s+/); // Split by whitespace
            const storyWordCount = storyWords.length;

            // Create 15 replies to the original story
            for (let storyIdReplyNumber = 0; storyIdReplyNumber < 15; storyIdReplyNumber++) {
                const rootReplyId = Uuid25.fromBytes(uuidv7obj().bytes).value;
                const timestamp = Date.now();

                // --- Refactored Excerpt/Quote Generation for Story Content ---
                let quoteResult: { start: number; end: number; excerpt: string } | null = null;
                if (storyWordCount > 0) {
                    const maxExcerptLength = Math.min(storyWordCount, 15); // Limit excerpt length
                    const excerptLength = randomInt(1, maxExcerptLength + 1); // Ensure length is at least 1
                    const startWordIndex = randomInt(0, storyWordCount - excerptLength + 1); // Ensure start index allows for excerpt length
                    const endWordIndex = startWordIndex + excerptLength;

                    quoteResult = calculateCharIndices(storyContent, startWordIndex, endWordIndex);
                }

                if (!quoteResult || quoteResult.excerpt.length === 0) {
                    logger.warn(`Could not generate valid excerpt for story ${storyId}, skipping reply ${storyIdReplyNumber}`);
                    continue;
                }
                // --- End Refactored Excerpt/Quote Generation ---


                const replyText = `This is a test reply (to a story tree) to help with testing the reply functionality. storyId: [${storyId}], storyIdReplyNumber: [${storyIdReplyNumber}].`;

                // Create a test quote targeting the calculated excerpt of the parent story
                const quote: Quote = {
                    text: quoteResult.excerpt,
                    sourceId: storyId,
                    selectionRange: {
                        start: quoteResult.start,
                        end: quoteResult.end
                    }
                };

                // Create the reply object using rootReplyId
                const reply: Reply = {
                    id: rootReplyId,
                    text: replyText,
                    parentId: [storyId],
                    quote: quote,
                    authorId: 'seed_user',
                    createdAt: timestamp.toString() // Consider using toISOString() for consistency
                };

                // Store 5 identical replies with unique IDs
                let firstUniqueReplyId = ''; // Store the ID of the first one created
                for (let i = 0; i < 5; i++) {
                    const uniqueReplyId = Uuid25.fromBytes(uuidv7obj().bytes).value;
                    if (i === 0) {
                        firstUniqueReplyId = uniqueReplyId; // Capture the first ID
                    }
                    const modifiedReplyText = `${replyText} (Copy ${i + 1})`; // Add identifier
                    const replyToStore: Reply = {
                        id: uniqueReplyId, // Assign unique ID
                        text: modifiedReplyText, // Use modified text
                        parentId: [storyId],
                        quote: quote,
                        authorId: 'seed_user',
                        createdAt: timestamp.toString()
                    };
                    await storeReply(replyToStore);
                }

                // create replies to the reply
                const replyWords = replyText.split(/\s+/); // Split by whitespace
                const replyWordCount = replyWords.length;

                // Create 8 replies to the first-level reply
                for (let replyReplyNumber = 0; replyReplyNumber < 8; replyReplyNumber++) {
                    const replyReplyId = Uuid25.fromBytes(uuidv7obj().bytes).value;
                    const timestampReply = Date.now(); // Use a new timestamp

                     // --- Refactored Excerpt/Quote Generation for Reply Content ---
                    let quoteResultReply: { start: number; end: number; excerpt: string } | null = null;
                    if (replyWordCount > 0) {
                         const maxExcerptLengthReply = Math.min(replyWordCount, 10); // Limit excerpt length
                         const excerptLengthReply = randomInt(1, maxExcerptLengthReply + 1); // Ensure length is at least 1
                         const startWordIndexReply = randomInt(0, replyWordCount - excerptLengthReply + 1); // Ensure start index allows for excerpt length
                         const endWordIndexReply = startWordIndexReply + excerptLengthReply;

                        quoteResultReply = calculateCharIndices(replyText, startWordIndexReply, endWordIndexReply);
                    }

                     if (!quoteResultReply || quoteResultReply.excerpt.length === 0) {
                        logger.warn(`Could not generate valid excerpt for reply ${rootReplyId}, skipping reply-reply ${replyReplyNumber}`);
                        continue;
                     }
                     // --- End Refactored Excerpt/Quote Generation ---


                    const replyReplyText = `This is a test reply (to a reply) to help with testing the reply functionality. storyId: [${storyId}], storyIdReplyNumber: [${storyIdReplyNumber}], replyReplyNumber: [${replyReplyNumber}].`;


                    // Create a test quote targeting the calculated excerpt of the parent reply
                    const quoteReply: Quote = {
                        text: quoteResultReply.excerpt,
                        sourceId: firstUniqueReplyId, // Parent is the first of the 5 identical first-level replies
                        selectionRange: {
                            start: quoteResultReply.start,
                            end: quoteResultReply.end
                        }
                    };

                    // Create the reply object template
                    const replyReply: Reply = {
                        id: '', // Placeholder ID, will be replaced in loop
                        text: replyReplyText,
                        parentId: [firstUniqueReplyId], // Parent is the FIRST of the 5 identical first-level replies
                        quote: quoteReply,
                        authorId: 'seed_user',
                        createdAt: timestampReply.toString() // Consider using toISOString()
                    };

                    // Store 5 identical replies with unique IDs
                    for (let j = 0; j < 5; j++) {
                        const uniqueReplyReplyId = Uuid25.fromBytes(uuidv7obj().bytes).value;
                        const modifiedReplyReplyText = `${replyReplyText} (Copy ${j + 1})`; // Add identifier
                        const replyReplyToStore: Reply = {
                           ...replyReply, // Copy base reply-reply data (includes parentId, quote, author, createdAt)
                            id: uniqueReplyReplyId, // Assign unique ID
                            text: modifiedReplyReplyText, // Use modified text
                        };
                         await storeReply(replyReplyToStore);
                    }
                }
            }
        }

        logger.info(`Successfully seeded test replies for ${storyIds.length} stories`);
    } catch (error) {
        // Handled - By Design: Catches errors during reply creation loops (including from storeReply).
        // Logs the error and re-throws. The error is then caught by the main seedDevStories
        // catch block, which logs again but *doesn't* re-throw, allowing the script to terminate
        // after logging the failure without necessarily crashing the parent process.
        logger.error('Error seeding test replies:', error);
        throw error;
    }
}

/**
 * Stores a single reply and updates relevant database indices.
 * @param reply The reply object to store.
 * @throws {Error} If any database operation (hSet, zAdd, hIncrementQuoteCount) fails.
 *                 (Handled: Propagated up to seedTestReplies).
 */
async function storeReply(reply: Reply) {
    const parentId = reply.parentId[0]; // Assuming single parent for simplicity
    const quote = reply.quote;
    const replyId = reply.id;
    const score = Date.now(); // Use current timestamp for score

    // Store the reply object itself
    await db.hSet(replyId, 'reply', JSON.stringify(reply));

    // Indexing - use safe quote key
    const quoteKey = getQuoteKey(quote);

    // 1. Index for "Replies by Parent ID and Quote"
    await db.zAdd(`replies:uuid:${parentId}:quote:${quoteKey}:mostRecent`, score, replyId);

    // 2. Increment quote count in the hash using the new method
    await db.hIncrementQuoteCount(`${parentId}:quoteCounts`, quoteKey, quote);
    
    // --- Reinstate removed indices ---
    // 3. Global replies feed
    await db.zAdd('replies:feed:mostRecent', score, replyId);
    
    // 4. Replies by Quote (General - using quoteKey)
    await db.zAdd(`replies:quote:${quoteKey}:mostRecent`, score, replyId);

    // 5. Replies by Parent ID and Sanitized Quote Text
    await db.zAdd(`replies:${parentId}:${quote.text}:mostRecent`, score, replyId);

    // 6. Conditional Replies by Sanitized Quote Text Only
    await db.zAdd(`replies:quote:${quote.text}:mostRecent`, score, replyId);
    // --- End reinstated indices ---

    logger.info(`Stored reply ${replyId} and updated indices for parent ${parentId}`);
}

export { seedDevStories }; 