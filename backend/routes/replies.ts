import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto'; // Import randomUUID
import logger from '../logger.js';
import {
    DatabaseClient as DatabaseClientType,
    AuthenticatedRequest,
    User,
    Reply,
    Quote,
    CreateReplyResponse,
    CompressedApiResponse,
    RepliesFeedResponse,
    SortingCriteria,
    RedisSortedSetItem,
    ExistingSelectableQuotes,
    Compressed,
    CursorPaginatedResponse
} from '../types/index.js';
import { getQuoteKey } from '../utils/quoteUtils.js';
import { uuidv7obj } from 'uuidv7';
import { Uuid25 } from 'uuid25';
import { authenticateToken } from '../middleware/authMiddleware.js';

// Use the imported type for the placeholder and the setDb function
let db: DatabaseClientType;
export const setDb = (databaseClient: DatabaseClientType) => {
    db = databaseClient;
};

const router = Router();

// Helper function to generate compressed 25-digit UUID v7
const generateCondensedUuid = (): string => {
    const uuidObj = uuidv7obj();
    const uuid25Instance = Uuid25.fromBytes(uuidObj.bytes);
    return uuid25Instance.value;
};

/**
 * @route   POST /replies/createReply
 * @desc    Creates a new reply
 * @access  Authenticated
 */
router.post('/createReply', authenticateToken, async (req: Request, res: Response<CreateReplyResponse>) => {
    // Generate IDs for logging context
    const operationId = randomUUID();
    const requestId = res.locals.requestId; // Get from middleware
    const logContext = { requestId, operationId }; 

    try {
        const text: string = req.body.text;
        const parentId: string | string[] = req.body.parentId;
        const quote: Quote = req.body.quote;
        const user: User = (req as AuthenticatedRequest).user;

        if (!text || !parentId || !quote || !quote.text || !quote.sourceId || !quote.selectionRange) {
            logger.warn(logContext, 'Missing required fields for createReply');
            res.status(400).json({
                success: false,
                error: 'Missing required fields. Ensure text, parentId, and a full quote (with text, sourceId, and selectionRange) are provided.'
            });
            return;
        }
        if (Array.isArray(parentId) && parentId.length === 0) {
             logger.warn(logContext, 'parentId array cannot be empty');
             res.status(400).json({ success: false, error: 'parentId array cannot be empty' });
             return;
        }

        const trimmedText = text.trim();
        const MAX_REPLY_LENGTH = 1000;
        const MIN_REPLY_LENGTH = 50;
        const IGNORE_MIN_REPLY_LENGTH = ["Yes!"];

        if (trimmedText.length > MAX_REPLY_LENGTH) {
            logger.warn({...logContext, textLength: trimmedText.length }, 'Reply text exceeds maximum length');
            res.status(400).json({
                success: false,
                error: `Reply text exceeds the maximum length of ${MAX_REPLY_LENGTH} characters.`
            });
            return;
        }
        if (!IGNORE_MIN_REPLY_LENGTH.includes(trimmedText) && trimmedText.length < MIN_REPLY_LENGTH) {
            logger.warn({...logContext, textLength: trimmedText.length }, 'Reply text below minimum length');
            res.status(400).json({
                success: false,
                error: `Reply text must be at least ${MIN_REPLY_LENGTH} characters long.`
            });
            return;
        }

        const newReply: Reply = {
            id: generateCondensedUuid(),
            text: trimmedText,
            parentId,
            quote,
            authorId: user.id,
            createdAt: new Date().getTime().toString()
        };

        // Log the replayable action intent and parameters *before* database calls
        logger.info(
            { 
                ...logContext,
                action: {
                    type: 'CREATE_REPLY',
                    params: {
                        replyId: newReply.id,
                        parentId: newReply.parentId,
                        authorId: newReply.authorId,
                        quoteSourceId: newReply.quote.sourceId,
                        // Avoid logging full text/quote content here for brevity unless needed
                        // textLength: trimmedText.length,
                        // quoteTextSnippet: newReply.quote.text.substring(0, 50) + '...',
                    }
                },
            },
            'Initiating CreateReply action'
        );

        // Pass logContext to all DB calls
        await db.hSet(newReply.id, 'reply', newReply, logContext);
        const quoteKey = getQuoteKey(quote);
        const score = Date.now();
        const actualParentId = Array.isArray(newReply.parentId) ? newReply.parentId[0] : newReply.parentId;
        const replyId = newReply.id;

        await db.zAdd(`replies:quote:${quoteKey}:mostRecent`, score, replyId, logContext);
        await db.zAdd(`replies:uuid:${actualParentId}:quote:${quoteKey}:mostRecent`, score, replyId, logContext);
        await db.hIncrementQuoteCount(`${actualParentId}:quoteCounts`, quoteKey, quote, logContext);
        await db.sAdd(`user:${user.id}:replies`, replyId, logContext);
        await db.zAdd('replies:feed:mostRecent', score, replyId, logContext);

        // Log success *after* database operations
        logger.info({ ...logContext, replyId, parentId: actualParentId }, 'Successfully created new reply');

        const response: CreateReplyResponse = {
            success: true,
            data: { id: replyId }
        };
        res.send(response);
    } catch (err) {
        // Ensure error logs also include context
        logger.error({ ...logContext, err }, 'Error creating reply');
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

// Temporary route for debugging type error
router.get('/test-debug', (req, res) => {
    res.status(200).send('Debug OK');
});

// New API endpoint: Retrieves quote reply counts for a given parent ID.
// Returns an CompressedApiResponse containing ExistingSelectableQuotes, where the quoteCounts property is an array of map entries.
router.get<{ parentId: string }, CompressedApiResponse<Compressed<ExistingSelectableQuotes>>>('/quoteCounts/:parentId', async (req: Request, res: Response) => {
    const { parentId } = req.params;
    if (!parentId) {
        res.status(400).json({ success: false, error: 'Parent ID is required' });
        return;
    }
    try {
        // Retrieve the quote reply counts from Firebase using the key pattern: "<parentId>:quoteCounts"
        const rawQuoteData = await db.hGetAll(`${parentId}:quoteCounts`);

        if (!rawQuoteData) {
          // Handle case where no counts exist for this parent
          const compressedResponse = await db.compress({ quoteCounts: [] });
          const apiResponse: CompressedApiResponse<Compressed<ExistingSelectableQuotes>> = {
              success: true,
              compressedData: compressedResponse
          };
          res.setHeader('X-Data-Compressed', 'true');
          res.send(apiResponse);
          return;
        }

        // Process the raw results into a Map<Quote, number>
        const quoteCountsMap = new Map<Quote, number>();
        for (const [_key, valueObj] of Object.entries(rawQuoteData)) {
            // The valueObj should be { quote: QuoteObject, count: number }
            if (valueObj && typeof valueObj === 'object' && valueObj.quote && typeof valueObj.count === 'number') {
                // Ensure the quote structure is valid before adding
                // You might want more robust validation based on the Quote type definition
                if (valueObj.quote.text && valueObj.quote.sourceId && valueObj.quote.selectionRange) {
                    quoteCountsMap.set(valueObj.quote as Quote, valueObj.count);
                } else {
                    logger.warn({ parentId, quote: valueObj.quote }, 'Invalid quote structure found in quoteCounts');
                }
            } else {
                logger.warn({ parentId, data: valueObj }, 'Invalid data structure found in quoteCounts');
            }
        }
        
        // Convert the Map into an array of entries.
        // This is equivalent to: JSON.stringify(Array.from(quoteCountsMap.entries()))
        // since res.json will automatically serialize the object.
        const quoteCountsArray = Array.from(quoteCountsMap.entries());
        const compressedResponse = await db.compress({ quoteCounts: quoteCountsArray });

        const CompressedApiResponse: CompressedApiResponse<Compressed<ExistingSelectableQuotes>> = {
            success: true,
            compressedData: compressedResponse
        };
        res.setHeader('X-Data-Compressed', 'true');
        res.send(CompressedApiResponse);
    } catch (error) {
        logger.error({ parentId, err: error }, 'Error retrieving quote counts');
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * @route   GET /getReplies/:parentId/:quote/:sortCriteria
 * @desc    Retrieves replies associated with a specific quote on a parent node.
 * @access  Authenticated (implicitly, as the router is mounted with auth)
 * @param   {string} parentId - The ID of the parent node (previously uuid).
 * @param   {string} quote - URL-encoded JSON string of the Quote object.
 * @param   {SortingCriteria} sortCriteria - Sorting order (e.g., 'mostRecent').
 * @query   {number} [limit=10] - Max number of replies per page.
 * @query   {string} [cursor] - Pagination cursor (score for zscan).
 * @returns {CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>>} Compressed response with replies and pagination.
 */
router.get<{
    parentId: string;
    quote: string;
    sortCriteria: SortingCriteria
}, CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>>>('/getReplies/:parentId/:quote/:sortCriteria', async (req, res) => {
    try {
        const { parentId, quote, sortCriteria } = req.params;
        let quoteObj: Quote;

        // Decode and parse the quote object from the URL parameter
        try {
            const decodedQuote = decodeURIComponent(quote);
            try {
                quoteObj = JSON.parse(decodedQuote);
            } catch (e) {
                logger.error({ parentId, quote: decodedQuote, err: e }, 'Error parsing quote');
                throw new Error('Invalid quote format');
            }
        } catch (error) {
            const errorResponse: CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>> = {
                success: false,
                error: 'Invalid quote object provided in URL parameter'
            };
            res.status(400).json(errorResponse);
            return;
        }

        // Validate that the quote object includes the required fields.
        if (!quoteObj.text || !quoteObj.sourceId || !quoteObj.selectionRange) {
            const errorResponse: CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>> = {
                success: false,
                error: 'Quote object must include text, sourceId, and selectionRange fields'
            };
            res.status(400).json(errorResponse);
            return;
        }

        // Generate a unique key for the quote using its properties.
        const quoteKey = getQuoteKey(quoteObj);
        logger.info({ parentId, quote: quoteObj, sortCriteria }, '[getReplies] Processing request');
        
        // Pagination parameters
        const MAX_LIMIT = 100; // Cap the limit to prevent excessive data requests
        const limit = Math.min(parseInt(req.query.limit as string) || 10, MAX_LIMIT);
        const cursor = req.query.cursor as string | undefined; // Cursor is the score for zscan, can be undefined

        // Build the sorted set key for replies based on parent ID, full quote object key, and sorting criteria.
        // Note: This key matches the one used in createReply
        const sortedSetKey = `replies:uuid:${parentId}:quote:${quoteKey}:${sortCriteria}`;
        logger.info('[getReplies] Constructed Redis key: %s', sortedSetKey);

        // Get total count for pagination info
        const totalCount = await db.zCard(sortedSetKey) || 0;

        // Fetch reply IDs from the sorted set using zRangeByScore with limit
        // We need scores to determine the next cursor.
        // zscan cursor isn't reliable for pagination here as we need the score.
        // Fetch one extra item to determine if there's more.
        const fetchLimit = limit + 1;
        
        // Correct call using zRevRangeByScore
        // Max score: If cursor exists, use it as the upper bound (inclusive). Otherwise, use a safe large number.
        // Min score: Always -Infinity to get all older items.
        // Limit: Fetch one extra item to check for 'hasMore'.
        const maxScore = cursor ? Number(cursor) : Number.MAX_SAFE_INTEGER; // Use safe integer instead of '+inf'
        const minScore = '-inf';                       // Use '-inf' for Redis command
        // Ensure T matches the expected structure returned by zRevRangeByScore
        // (which returns RedisSortedSetItem<T>, where T is the base type stored, potentially compressed)
        // Let's assume the base type T stored via zAdd was the compressed reply ID string.
        // Note: The RedisClient's zRevRangeByScore expects numeric scores, but internally converts to string for the command.
        // We pass numbers or +/-inf strings here, relying on the client's internal String() conversion.
        const maxScoreNum = maxScore === Number.MAX_SAFE_INTEGER ? Infinity : Number(maxScore); // Convert MAX_SAFE_INTEGER back to Infinity if needed for client
        const minScoreNum = minScore === '-inf' ? -Infinity : Number(minScore); // Keep as number for interface

        // Expect Array<{ score: number, value: string (replyId) }>
        const rawReplyItemsWithScores = await db.zRevRangeByScore<string>(sortedSetKey, maxScoreNum, minScoreNum, { limit: fetchLimit });

        // Fix the log message
        logger.info('[getReplies] Fetched %d raw reply items from sorted set.', rawReplyItemsWithScores.length);

        // Determine if there are more items beyond the requested limit
        const hasMore = rawReplyItemsWithScores.length > limit;
        const itemsToProcess = hasMore ? rawReplyItemsWithScores.slice(0, limit) : rawReplyItemsWithScores;
        
        // Extract the score of the last processed item for the next cursor
        const nextCursor = hasMore ? itemsToProcess[itemsToProcess.length - 1]?.score.toString() : undefined;

        // Fetch the actual reply data for each ID
        const replies = await Promise.all(
            // Map over itemsToProcess which is Array<{ score: number, value: string }>
            itemsToProcess.map(async (item) => { 
                let replyId = item.value; // Access reply ID from item.value
                try {
                    const replyData = await db.hGet(replyId, 'reply'); 
                    // logger.info({ replyId: replyId, dataPresent: !!replyData }, '[getReplies] Raw reply data fetched');
                    // Log the actual data received after hGet and decompression
                    logger.info({ replyId: replyId, fetchedData: replyData }, '[getReplies] Decompressed reply data received');

                    if (typeof replyData === 'object' && replyData !== null) {
                        // Validate structure (add more checks as needed)
                         if ('id' in replyData && 'text' in replyData && 'authorId' in replyData) {
                            return replyData as Reply;
                         } else {
                            logger.warn({ replyId: replyId, data: replyData }, '[getReplies] Invalid reply structure found');
                            return null;
                         }
                    } else {
                         logger.warn({ replyId: replyId, dataType: typeof replyData }, '[getReplies] Unexpected data type or null after hGet');
                         return null;
                    }
                } catch (err) {
                    logger.error({ replyId: replyId, err }, `Error during hGet or processing for reply`);
                    return null;
                }
            })
        );

        // Filter out any null values from failed fetches
        const validReplies = replies.filter((reply: Reply | null): reply is Reply => reply !== null);
        logger.info('[getReplies] Processed %d valid replies.', validReplies.length);

        // Prepare the response object with cursor pagination info
        const responseData = {
            success: true,
            data: validReplies,
            pagination: {
                nextCursor: nextCursor, // Use the score of the last item as the next cursor
                hasMore: hasMore,
                totalCount: totalCount
            }
        } as CursorPaginatedResponse<Reply>; // Make sure this type matches

        // Compress and send the response
        const compressedResponse = await db.compress(responseData) as Compressed<CursorPaginatedResponse<Reply>>;
        res.setHeader('X-Data-Compressed', 'true');
        const apiResponse: CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>> = {
            success: true,
            compressedData: compressedResponse
        };
        res.send(apiResponse);
    } catch (err) {
        logger.error('Error fetching replies by quote: %O', err);
        const errorResponse: CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>> = {
            success: false,
            error: 'Server error fetching replies'
        };
        res.status(500).json(errorResponse);
    }
});

export default router;