import { Router, Request, Response } from 'express';
import logger from '../logger.js';
import {
    AuthenticatedRequest,
    User,
    Quote,
    CreateReplyResponse, SortingCriteria, CursorPaginatedResponse,
    CreateReplyRequest
} from '../types/index.js';
import { uuidv7obj } from 'uuidv7';
import { Uuid25 } from 'uuid25';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { getQuoteKey as generateHashedQuoteKey } from '../utils/quoteUtils.js';
import { LoggedDatabaseClient } from '../db/LoggedDatabaseClient.js';

let db: LoggedDatabaseClient;
export const setDb = (databaseClient: LoggedDatabaseClient) => {
    db = databaseClient;
};

const router = Router();

// Helper function to generate compressed 25-digit UUID v7
const generateCondensedUuid = (): string => {
    const uuidObj = uuidv7obj();
    const uuid25Instance = Uuid25.fromBytes(uuidObj.bytes);
    return uuid25Instance.value;
};



// Helper to sanitize keys for Firebase paths (percent encoding)
function sanitizeKey(key: string): string {
    let encoded = encodeURIComponent(key);
    encoded = encoded.replace(/\./g, '%2E');
    encoded = encoded.replace(/\$/g, '%24');
    encoded = encoded.replace(/#/g, '%23');
    encoded = encoded.replace(/\[/g, '%5B');
    encoded = encoded.replace(/\]/g, '%5D');
    encoded = encoded.replace(/\//g, '%2F');
    return encoded;
}

// Define ReplyData structure inline (based on backend_architecture.md)
interface ReplyData {
  id: string;
  authorId: string;
  text: string;
  parentId: string; // ID of the direct parent (post or reply)
  parentType: "post" | "reply"; // Type of the direct parent
  rootPostId: string; // ID of the original post tree root
  quote: Quote;
  createdAt: string; // ISO 8601 Timestamp String (consider changing to number for sorting)
}

/**
 * @route   POST /replies/createReply
 * @desc    Creates a new reply
 * @access  Authenticated
 */
router.post<{}, CreateReplyResponse, CreateReplyRequest>('/createReply', authenticateToken, async (req, res) => {
    // Generate IDs for logging context
    const operationId = generateCondensedUuid();
    const requestId = res.locals.requestId; // Get from middleware
    const logContext = { requestId, operationId };

    try {
        const { text, parentId, quote } = req.body as CreateReplyRequest;
        const user: User = (req as AuthenticatedRequest).user;

        if (!text || !parentId || !quote || !quote.text || !quote.sourceId || !quote.selectionRange) {
            logger.warn(logContext, 'Missing required fields for createReply');
            res.status(400).json({ success: false, error: 'Missing required fields.' });
            return;
        }
        // Removed parentId array check as model expects string

        const trimmedText = text.trim();
        const MAX_REPLY_LENGTH = 1000;
        const MIN_REPLY_LENGTH = 50;
        const IGNORE_MIN_REPLY_LENGTH = ["Yes!"];

        if (trimmedText.length > MAX_REPLY_LENGTH) {
            logger.warn({...logContext, textLength: trimmedText.length }, 'Reply text exceeds maximum length');
            res.status(400).json({ success: false, error: `Reply text exceeds max length.` });
            return;
        }
        if (!IGNORE_MIN_REPLY_LENGTH.includes(trimmedText) && trimmedText.length < MIN_REPLY_LENGTH) {
            logger.warn({...logContext, textLength: trimmedText.length }, 'Reply text below minimum length');
            res.status(400).json({ success: false, error: `Reply text below min length.` });
            return;
        }

        // --- Determine parentType and rootPostId --- 
        let parentType: "post" | "reply" | null = null;
        let rootPostId: string | null = null;
        const parentPost = await db.getPost(parentId); // Added logContext
        if (parentPost && parentPost.id === parentId) { // Add stricter check
            parentType = 'post';
            rootPostId = parentId;
        } else {
            const parentReply = await db.getReply(parentId); // Added logContext
            if (parentReply && parentReply.id === parentId) { // Add stricter check
                parentType = 'reply';
                rootPostId = parentReply.rootPostId;
            } else {
                logger.error({ ...logContext, parentId }, 'Parent post or reply not found for createReply');
                res.status(404).json({ success: false, error: 'Parent not found' });
                return;
            }
        }
        // --- End Parent/Root Lookup --- 

        const newReply: ReplyData = {
            id: generateCondensedUuid(),
            text: trimmedText,
            parentId: parentId,
            parentType: parentType!, // Use non-null assertion after validation
            rootPostId: rootPostId!, // Use non-null assertion after validation
            quote,
            authorId: user.id,
            createdAt: new Date().toISOString()
        };

        const score = new Date(newReply.createdAt).getTime();
        const replyId = newReply.id;
        const actualParentId = newReply.parentId;
        const actualRootPostId = newReply.rootPostId;
        const hashedQuoteKey = generateHashedQuoteKey(quote);

        // Log the replayable action intent and parameters *before* database calls
        logger.info(
            {
                ...logContext,
                action: {
                    type: 'CREATE_REPLY',
                    params: {
                        replyId: newReply.id,
                        parentId: newReply.parentId,
                        parentType: newReply.parentType,
                        rootPostId: newReply.rootPostId,
                        authorId: newReply.authorId,
                        quoteSourceId: newReply.quote.sourceId,
                        hashedQuoteKey: hashedQuoteKey,
                    }
                },
            },
            'Initiating CreateReply action'
        );

        await db.createReplyTransaction(newReply, hashedQuoteKey, logContext);

        logger.info({ ...logContext, replyId, parentId: actualParentId }, 'Successfully created new reply');

        const response: CreateReplyResponse = {
            success: true,
            data: { id: replyId }
        };
        res.status(201).send(response);
    } catch (err) {
        logger.error({ ...logContext, err }, 'Error creating reply');
        res.status(500).json({ success: false, error: 'Server error creating reply' });
    }
});

// Removed temporary debug route

// Retrieves quote reply counts for a given parent ID.
// Returns { success: boolean, data?: { quote: Quote, count: number }[], error?: string }
// Removed compression
router.get<{ parentId: string }, { success: boolean, data?: { quote: Quote, count: number }[], error?: string }>('/quoteCounts/:parentId', async (req: Request, res: Response) => {
    const { parentId } = req.params;
    const timeBucket = req.query.t as string | undefined; // Read timeBucket
    const requestId = res.locals.requestId;
    const logContext = { requestId, parentId, timeBucket };

    logger.debug(logContext, 'Handling request for quoteCounts');

    if (!parentId) {
        logger.warn(logContext, 'Parent ID is required for quoteCounts');
        res.status(400).json({ success: false, error: 'Parent ID is required' });
        return;
    }
    try {
        // Retrieve the quote reply counts from Firebase direct path
        const rawQuoteData = await db.getQuoteCountsForParent(parentId);

        if (!rawQuoteData) {
          // Handle case where no counts exist for this parent
          res.json({ success: true, data: [] });
          return;
        }

        // Process the raw results
        const quoteCountsArray: { quote: Quote, count: number }[] = [];
        for (const [_key, valueObj] of Object.entries(rawQuoteData)) {
            const v: any = valueObj;
            if (v && typeof v === 'object' && v.quote && typeof v.count === 'number') {
                // Basic validation of quote structure
                if (v.quote.text && v.quote.sourceId && v.quote.selectionRange) {
                    quoteCountsArray.push({ quote: v.quote as Quote, count: v.count });
                } else {
                    logger.warn({ parentId, quote: v.quote }, 'Invalid quote structure found in quoteCounts');
                }
            } else {
                logger.warn({ parentId, data: v }, 'Invalid data structure found in quoteCounts');
            }
        }

        // Set Cache-Control header
        res.setHeader('Cache-Control', 'public, max-age=60'); // Cache for 60 seconds
        // Send plain JSON response
        res.json({ success: true, data: quoteCountsArray });

    } catch (error) {
        logger.error({ ...logContext, err: error }, 'Error retrieving quote counts');
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * @route   GET /replies/getReplies/:parentId/:quote/:sortCriteria
 * @desc    Retrieves replies associated with a specific quote on a parent node.
 * @access  Public (Adjust if auth needed)
 * @param   {string} parentId - The ID of the parent node (previously uuid).
 * @param   {string} quote - URL-encoded JSON string of the Quote object.
 * @param   {SortingCriteria} sortCriteria - Sorting order (e.g., 'mostRecent').
 * @query   {number} [limit=10] - Max number of replies per page.
 * @query   {string} [cursor] - Pagination cursor (timestamp_replyId key for zscan).
 * @returns {CursorPaginatedResponse<ReplyData>} Response with replies and pagination.
 */
router.get<{ parentId: string; quote: string; sortCriteria: SortingCriteria }, CursorPaginatedResponse<ReplyData> | { success: boolean; error: string }>('/getReplies/:parentId/:quote/:sortCriteria', async (req, res) => {
    try {
        const { parentId, quote, sortCriteria } = req.params;
        const timeBucket = req.query.t as string | undefined; // Read timeBucket
        const requestId = res.locals.requestId;
        const logContext = { requestId, parentId, quote, sortCriteria, timeBucket };

        logger.debug(logContext, 'Handling request for getReplies');

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
            res.status(400).json({ success: false, error: 'Invalid quote object provided' });
            return;
        }

        // Validate that the quote object includes the required fields.
        if (!quoteObj.text || !quoteObj.sourceId || !quoteObj.selectionRange) {
            res.status(400).json({ success: false, error: 'Quote object incomplete' });
            return;
        }

        // Generate the hashed quote key for index lookup
        const hashedQuoteKey = generateHashedQuoteKey(quoteObj);

        // Pagination parameters
        const MAX_LIMIT = 100;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, MAX_LIMIT);
        const cursor = req.query.cursor as string | undefined; // Cursor is the timestamp_replyId key


        if (!(sortCriteria in SortingCriteria)) {
          res.status(400).json({ success: false, error: 'Invalid sort criteria' });
          return;
        }
                // Get total count (using zCard with mapped key)
        const totalCount = await db.getReplyCountByParentQuote(parentId, hashedQuoteKey, sortCriteria) || 0;

        // Fetch reply IDs using zscan for cursor stability
        // FirebaseClient.zscan should handle mapping zSetKey to the index path
        // and using orderByKey().limitToFirst().startAfter(cursor)
        const { items: replyItems, nextCursor: nextCursorRaw } = await db.getReplyIdsByParentQuote(parentId, hashedQuoteKey, sortCriteria, limit, cursor);
        // zscan returns { score: number, value: string (replyId) }[]


        // Fetch the actual reply data for each ID using direct path
        const repliesPromises = replyItems.map(async (item: any) => {
            const replyId = item.value; // Reply ID is in the 'value' field
            try {
                // Remove surrounding quotes from replyId if they exist
                const sanitizedReplyId = replyId.replace(/^"|"$/g, '');
                const replyData = await db.getReply(sanitizedReplyId);
                if (replyData) {
                    // TODO: Add validation check (isValidNewReply) if needed
                    return replyData;
                } else {
                    logger.warn({ replyId: sanitizedReplyId }, '[getReplies] Reply data not found for ID from index');
                    return null;
                }
            } catch (err) {
                logger.error({ replyId: item.value, err }, `[getReplies] Error during get for reply`); // Log original item.value in case of error
                return null;
            }
        });

        const repliesData = await Promise.all(repliesPromises);
        const validReplies = repliesData.filter((reply): reply is ReplyData => reply !== null);

        // Determine hasMore based on if zscan returned a cursor indicating more data
        const hasMore = nextCursorRaw !== '0';
        const nextCursor = hasMore && nextCursorRaw ? nextCursorRaw : undefined;

        // Prepare the response object (no compression)
        const responseData: CursorPaginatedResponse<ReplyData> = {
            success: true,
            data: validReplies,
            pagination: {
                nextCursor: nextCursor,
                hasMore: hasMore,
                totalCount: totalCount
            }
        };

        // Set Cache-Control header
        res.setHeader('Cache-Control', 'public, max-age=60'); // Cache for 60 seconds

        res.json(responseData);

    } catch (err) {
        // Log with context, but don't send context to client for security
        const minimalLogContext = { 
            requestId: res.locals.requestId, 
            parentId: req.params.parentId, 
            quoteParam: req.params.quote, // Avoid logging potentially large parsed quoteObj unless necessary
            sortCriteria: req.params.sortCriteria,
            timeBucket: req.query.t
        };
        logger.error({ ...minimalLogContext, err }, 'Error fetching replies by quote');
        res.status(500).json({ success: false, error: 'Server error fetching replies' });
    }
});

export default router;