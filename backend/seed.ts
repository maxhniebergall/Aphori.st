/*
Requirements:
- Seed script must clear existing feed items before adding new ones
- Each post must have a unique v7 (timestamp sortable) UUID
- Posts must be stored in Redis with proper metadata
- Must use backend server's database client for compression support
- Must be exportable as a function for programmatic seeding
- Must maintain idempotency when run multiple times
*/

import { uuidv7obj } from "uuidv7";
import { Uuid25 } from "uuid25";
import logger from './logger.js';
import { FeedItem, Post, Reply, Quote } from './types/index.js';
import { getQuoteKey } from './utils/quoteUtils.js';
import { randomInt } from 'crypto';
import { DatabaseClient, ReplyData } from './types';
import { FirebaseClient } from './db/FirebaseClient.js';

// const logger = newLogger("seed.ts"); // Removed incorrect instantiation

interface PostContent {
    content: string;
}

let db: DatabaseClient; // Declare db as a DatabaseClient instance

// List of sample posts
const samplePosts: PostContent[] = [
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
 * Seeds the database with initial development posts.
 * Clears existing feed items and post IDs before seeding.
 * Uses the provided database client instance.
 * @param dbClient The database client instance to use.
 * @throws {Error} If clearing old data or creating initial posts fails.
 *                 (Handled - By Design: Logs error and re-throws to stop seeding).
 */
async function seedDevPosts(dbClient: DatabaseClient): Promise<void> {
    try {
        db = dbClient; // Use the passed-in dbClient
        logger.info("Attempting to seed data");

        // Clear existing data using direct path removal via FirebaseClient if possible
        let firebaseClientInstance: FirebaseClient | null = null;
        if (dbClient instanceof FirebaseClient) {
            firebaseClientInstance = dbClient;
        } // Add more checks if dbClient might be wrapped

        if (firebaseClientInstance) {
            const pathsToClear = [
                'posts', // Clear entire posts node
                'replies', // Clear entire replies node
                'feedItems', // Clear entire feedItems node
                'feedStats', // Clear feedStats node
                'postMetadata', // Clear post metadata
                'replyMetadata', // Clear reply metadata
                'userMetadata/userPosts', // Clear user posts maps
                'userMetadata/userReplies', // Clear user replies maps
                'indexes' // Clear all indexes
                // Keep users and userMetadata/userIds, userMetadata/emailToId
            ];
            logger.info("Clearing existing data paths using FirebaseClient...");
            for (const path of pathsToClear) {
                try {
                    await firebaseClientInstance.removePath(path);
                    logger.info(`Cleared path: ${path}`);
                } catch (clearErr) {
                    logger.warn(`Failed to clear path ${path}:`, clearErr);
                }
            }
        } else {
            logger.warn("Could not get FirebaseClient instance, attempting generic key deletion (less reliable)...");
            // Fallback to less reliable key deletion if direct path removal isn't available
            try {
                // This is less ideal as it might rely on old key formats or miss data
                await db.del('feedItems');
                await db.del('allPostTreeIds'); // Old key? May not exist or work as expected.
                await db.del('feedStats/itemCount'); // Old key?
                // Add deletions for other potentially old top-level keys if known
                logger.info("Attempted to clear keys using db.del (fallback).");
            } catch (err) {
                logger.error('Fallback key deletion failed:', err);
                // Decide if this is critical enough to stop seeding
                // throw new Error("Failed to clear existing data during fallback.");
            }
        }

        const postIds: string[] = [];
        const postContents: string[] = [];

        // Create each post
        for (const postContent of samplePosts) {
            const uuid = Uuid25.fromBytes(uuidv7obj().bytes).value;
            postIds.push(uuid);
            postContents.push(postContent.content);
            
            // Create the post following Post schema structure
            const formattedPost: Post = {
                id: uuid,
                content: postContent.content,
                authorId: 'seed_user',
                createdAt: new Date().toISOString(),
                replyCount: 0 // Initialize reply count
            };

            // STORE POST DIRECTLY AT /posts/$postId
            await db.set(`posts/${uuid}`, formattedPost);
            
            // Add to global post set using sAdd and correct path mapping
            await db.sAdd('allPostTreeIds:all', uuid);
            
            // Add to user's post set
            await db.sAdd(`userPosts:${formattedPost.authorId}`, uuid);
            
            // Add to feed items
            const feedItem: FeedItem = {
                id: uuid,
                authorId: formattedPost.authorId,
                textSnippet: formattedPost.content.substring(0, 100), // Use textSnippet
                createdAt: formattedPost.createdAt
            };
            await db.lPush('feedItems', feedItem); // lPush handles path mapping for feedItems
            await db.incrementFeedCounter(1); // Increment feed counter
            
            logger.info(`Created new post with UUID: ${uuid} and added to feed/indexes.`);
        }
        await seedTestReplies(postIds, postContents);
        logger.info("Successfully seeded dev posts and replies.");
    } catch (error) {
        logger.error('Error seeding dev posts:', error);
        throw error; // Re-throw critical seeding errors
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
 * Seeds test replies for the given post IDs.
 * Creates multiple levels of nested replies with generated quotes.
 * @param postIds Array of parent post IDs.
 * @param postContents Array of corresponding post content strings.
 * @throws {Error} If storing replies or updating indices fails.
 *                 (Handled - By Design: Logs error and re-throws, caught by seedDevPosts).
 */
async function seedTestReplies(postIds: string[], postContents: string[]): Promise<void> {
    try {
        logger.info("Seeding test replies...");
        for (const postId of postIds) {
            const postContent = postContents[postIds.indexOf(postId)];
            const postWords = postContent.split(/\s+/); // Split by whitespace
            const postWordCount = postWords.length;

            // Create 15 replies to the original post
            for (let postIdReplyNumber = 0; postIdReplyNumber < 15; postIdReplyNumber++) {
                const rootReplyId = Uuid25.fromBytes(uuidv7obj().bytes).value;
                const timestamp = Date.now();

                // --- Refactored Excerpt/Quote Generation for Post Content ---
                let quoteResult: { start: number; end: number; excerpt: string } | null = null;
                if (postWordCount > 0) {
                    const maxExcerptLength = Math.min(postWordCount, 15); // Limit excerpt length
                    const excerptLength = randomInt(1, maxExcerptLength + 1); // Ensure length is at least 1
                    const startWordIndex = randomInt(0, postWordCount - excerptLength + 1); // Ensure start index allows for excerpt length
                    const endWordIndex = startWordIndex + excerptLength;

                    quoteResult = calculateCharIndices(postContent, startWordIndex, endWordIndex);
                }

                if (!quoteResult || quoteResult.excerpt.length === 0) {
                    logger.warn(`Could not generate valid excerpt for post ${postId}, skipping root reply creation ${postIdReplyNumber}`);
                    continue;
                }
                // --- End Refactored Excerpt/Quote Generation ---


                const replyText = `This is reply ${postIdReplyNumber + 1}/15 to post [${postId}]. It quotes '${quoteResult.excerpt}'.`;

                // Create a test quote targeting the calculated excerpt of the parent post
                const quote: Quote = {
                    text: quoteResult.excerpt,
                    sourceId: postId, // Source is the post
                    selectionRange: {
                        start: quoteResult.start,
                        end: quoteResult.end
                    }
                };

                // Create the FIRST-LEVEL reply object using rootReplyId - Use ReplyData structure
                const firstLevelReply: ReplyData = {
                    id: rootReplyId,
                    text: replyText,
                    parentId: postId,        // Direct parent is the post
                    parentType: 'post',     // Parent type is post
                    rootPostId: postId,        // Root is the post itself
                    quote: quote,
                    authorId: 'seed_user',
                    createdAt: new Date(timestamp).toISOString() // Use ISO string timestamp
                };

                // Store 5 copies of this first-level reply, each with a unique ID
                let firstUniqueReplyId = ''; // Store the ID of the first copy created
                for (let i = 0; i < 5; i++) {
                    const uniqueReplyId = Uuid25.fromBytes(uuidv7obj().bytes).value;
                    if (i === 0) {
                        firstUniqueReplyId = uniqueReplyId; // Capture the first ID
                    }
                    const modifiedReplyText = `${replyText} (Copy ${i + 1})`; // Add identifier
                    const replyToStore: ReplyData = {
                        ...firstLevelReply, // Copy base data
                        id: uniqueReplyId, // Assign unique ID
                        text: modifiedReplyText, // Use modified text
                        createdAt: new Date(timestamp + i).toISOString() // Slightly different timestamp for ordering
                    };
                    await storeReply(replyToStore);
                }

                // --- Create replies TO the first-level reply ---
                const parentReplyText = firstLevelReply.text; // Text of the first-level reply (before modification)
                const parentReplyId = firstUniqueReplyId; // ID of the first copy of the first-level reply
                const parentReplyWords = parentReplyText.split(/\s+/);
                const parentReplyWordCount = parentReplyWords.length;

                // Create 8 replies to the first-level reply (specifically, to the first copy)
                for (let replyReplyNumber = 0; replyReplyNumber < 8; replyReplyNumber++) {
                    const secondLevelReplyId = Uuid25.fromBytes(uuidv7obj().bytes).value;
                    const timestampReply = timestamp + 1000 * (replyReplyNumber + 1); // Use a new timestamp

                     // --- Refactored Excerpt/Quote Generation for Parent Reply Content ---
                    let quoteResultReply: { start: number; end: number; excerpt: string } | null = null;
                    if (parentReplyWordCount > 0) {
                         const maxExcerptLengthReply = Math.min(parentReplyWordCount, 10); // Limit excerpt length
                         const excerptLengthReply = randomInt(1, maxExcerptLengthReply + 1); // Ensure length is at least 1
                         const startWordIndexReply = randomInt(0, parentReplyWordCount - excerptLengthReply + 1); // Ensure start index allows for excerpt length
                         const endWordIndexReply = startWordIndexReply + excerptLengthReply;

                        quoteResultReply = calculateCharIndices(parentReplyText, startWordIndexReply, endWordIndexReply);
                    }

                     if (!quoteResultReply || quoteResultReply.excerpt.length === 0) {
                        logger.warn(`Could not generate valid excerpt for reply ${parentReplyId}, skipping second-level reply ${replyReplyNumber}`);
                        continue;
                     }
                     // --- End Refactored Excerpt/Quote Generation ---


                    const replyReplyText = `This is reply ${replyReplyNumber + 1}/8 to reply [${parentReplyId.substring(0, 5)}...]. It quotes '${quoteResultReply.excerpt}'.`;


                    // Create a test quote targeting the calculated excerpt of the parent reply
                    const quoteReply: Quote = {
                        text: quoteResultReply.excerpt,
                        sourceId: parentReplyId, // Source is the parent reply
                        selectionRange: {
                            start: quoteResultReply.start,
                            end: quoteResultReply.end
                        }
                    };

                    // Create the SECOND-LEVEL reply object template
                    const secondLevelReply: ReplyData = {
                        id: '', // Placeholder ID, will be replaced in loop
                        text: replyReplyText,
                        parentId: parentReplyId,    // Direct parent is the first-level reply
                        parentType: 'reply',   // Parent type is reply
                        rootPostId: postId,        // Root is still the original post
                        quote: quoteReply,
                        authorId: 'seed_user',
                        createdAt: new Date(timestampReply).toISOString() // Use ISO string timestamp
                    };

                    // Store 5 identical copies of this second-level reply with unique IDs
                    for (let j = 0; j < 5; j++) {
                        const uniqueReplyReplyId = Uuid25.fromBytes(uuidv7obj().bytes).value;
                        const modifiedReplyReplyText = `${replyReplyText} (Copy ${j + 1})`; // Add identifier
                        const replyReplyToStore: ReplyData = {
                           ...secondLevelReply, // Copy base reply-reply data
                            id: uniqueReplyReplyId, // Assign unique ID
                            text: modifiedReplyReplyText, // Use modified text
                            createdAt: new Date(timestampReply + j).toISOString() // Slightly different timestamp
                        };
                         await storeReply(replyReplyToStore);
                    }
                }
            }
        }

        logger.info(`Successfully seeded test replies for ${postIds.length} posts`);
    } catch (error) {
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
async function storeReply(reply: ReplyData) {
    const parentId = reply.parentId; // Direct parent ID
    const quote = reply.quote;
    const replyId = reply.id;
    const score = new Date(reply.createdAt).getTime(); // Use createdAt for score consistently
    const authorId = reply.authorId;
    const rootPostId = reply.rootPostId;

    // STORE REPLY DIRECTLY AT /replies/$replyId
    await db.set(`replies/${replyId}`, reply);

    // Update Metadata/Indexes using correct paths/methods
    const quoteKey = getQuoteKey(quote); // Use consistent quote key generation

    // 1. Index for "Replies Feed by Timestamp" (/indexes/repliesFeedByTimestamp)
    await db.zAdd('replies:feed:mostRecent', score, replyId);

    // 2. Index for "Replies by Parent and Quote Timestamp" (/indexes/repliesByParentQuoteTimestamp)
    // Ensure parentId and quoteKey are sanitized if they contain forbidden chars
    // Assuming db.zAdd handles mapping 'replies:uuid:...' to the correct index path
    await db.zAdd(`replies:uuid:${parentId}:quote:${quoteKey}:mostRecent`, score, replyId);

    // 3. Increment Quote Count (/replyMetadata/quoteCounts)
    // The key passed should map correctly, e.g., 'replyMetadata:quoteCounts:parentId' -> path + hashedQuoteKey
    // Assuming db.hIncrementQuoteCount handles path mapping
    await db.hIncrementQuoteCount(`replyMetadata:quoteCounts:${parentId}`, quoteKey, quote);

    // 4. Update User Replies Set (/userMetadata/userReplies)
    await db.sAdd(`userReplies:${authorId}`, replyId);

    // 5. Update Post Replies Set (/postMetadata/postReplies) - Index under ROOT post
    await db.sAdd(`postReplies:${rootPostId}`, replyId);

    // 6. Increment Post Reply Count (/posts/$rootPostId/replyCount) - ATOMICALLY
    await db.hIncrBy(`posts:${rootPostId}`, 'replyCount', 1);

    // 7. Optional: Update Parent Replies Set (/replyMetadata/parentReplies) - Index under DIRECT parent
    await db.sAdd(`parentReplies:${parentId}`, replyId);

    // REMOVED old/redundant indices based on text - rely on quoteKey and timestamp indices
    // await db.zAdd(`replies:quote:${quoteKey}:mostRecent`, score, replyId); // Redundant if covered by #2?
    // await db.zAdd(`replies:${parentId}:${quote.text}:mostRecent`, score, replyId); // Unreliable text index
    // await db.zAdd(`replies:quote:${quote.text}:mostRecent`, score, replyId); // Unreliable text index

    logger.info(`Stored reply ${replyId} and updated indices/metadata.`);
}

export { seedDevPosts }; 