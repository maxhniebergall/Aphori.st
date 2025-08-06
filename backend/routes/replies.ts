import { Router, Request, Response } from 'express';
import logger from '../logger.js';
import {
    AuthenticatedRequest,
    User,
    Quote,
    CreateReplyResponse, SortingCriteria, CursorPaginatedResponse,
    CreateReplyRequest,
    Reply
} from '../types/index.js';
import { uuidv7obj } from 'uuidv7';
import { Uuid25 } from 'uuid25';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { getQuoteKey as generateHashedQuoteKey } from '../utils/quoteUtils.js';
import { LoggedDatabaseClient } from '../db/LoggedDatabaseClient.js';
import { VectorService } from '../services/vectorService.js';
import { DuplicateDetectionService } from '../services/duplicateDetectionService.js';

let db: LoggedDatabaseClient;
let vectorService: VectorService;
let duplicateDetectionService: DuplicateDetectionService;

export const setDb = (databaseClient: LoggedDatabaseClient, vs: VectorService) => {
    db = databaseClient;
    vectorService = vs;
    // Initialize duplicate detection service
    duplicateDetectionService = new DuplicateDetectionService(vs, databaseClient);
};

const router = Router();

// Helper function to generate compressed 25-digit UUID v7
const generateCondensedUuid = (): string => {
    const uuidObj = uuidv7obj();
    const uuid25Instance = Uuid25.fromBytes(uuidObj.bytes);
    return uuid25Instance.value;
};

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

        const replyId = newReply.id;
        const actualParentId = newReply.parentId;
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

        // Convert to Reply interface for duplicate detection BEFORE creating in database
        const replyForDuplicateCheck: Reply = {
            id: newReply.id,
            text: newReply.text,
            parentId: newReply.parentId,
            parentType: newReply.parentType,
            rootPostId: newReply.rootPostId,
            quote: newReply.quote,
            authorId: newReply.authorId,
            createdAt: newReply.createdAt
        };

        // Check for duplicates BEFORE creating the reply in regular indexes
        let isDuplicateHandled = false;
        if (duplicateDetectionService && vectorService) {
            try {
                const duplicateResult = await duplicateDetectionService.checkForDuplicates(replyForDuplicateCheck, logContext);
                
                if (duplicateResult.isDuplicate) {
                    logger.info({ ...logContext, replyId: newReply.id }, 'Duplicate reply detected, handling as duplicate', {
                        matchedReplyId: duplicateResult.matchedReplyId,
                        similarityScore: duplicateResult.similarityScore
                    });

                    try {
                        if (duplicateResult.duplicateGroup) {
                            // Add to existing duplicate group
                            await duplicateDetectionService.addToDuplicateGroup(
                                duplicateResult.duplicateGroup.id,
                                replyForDuplicateCheck,
                                duplicateResult.similarityScore!,
                                logContext
                            );
                        } else if (duplicateResult.matchedReplyId) {
                            // Create new duplicate group
                            const originalReply = await db.getReply(duplicateResult.matchedReplyId);
                            if (originalReply) {
                                await duplicateDetectionService.createDuplicateGroup(
                                    originalReply,
                                    replyForDuplicateCheck,
                                    duplicateResult.similarityScore!,
                                    logContext
                                );
                            }
                        }
                        
                        isDuplicateHandled = true;
                        logger.info({ ...logContext, replyId: newReply.id }, 'Successfully handled duplicate reply');
                    } catch (duplicateHandlingError) {
                        logger.error({ ...logContext, replyId: newReply.id, err: duplicateHandlingError }, 
                            'Error handling duplicate reply, falling back to regular reply creation');
                        // isDuplicateHandled remains false, so reply will be processed normally
                    }
                }
            } catch (duplicateError) {
                // Log error but don't fail the reply creation - fall back to regular reply
                logger.error({ ...logContext, replyId: newReply.id, err: duplicateError }, 
                    'Error during duplicate detection, falling back to regular reply creation');
            }
        }

        // Only create as regular reply if it's NOT a duplicate
        if (!isDuplicateHandled) {
            await db.createReplyTransaction(newReply, hashedQuoteKey, logContext);
            logger.info({ ...logContext, replyId, parentId: actualParentId }, 'Successfully created new regular reply');
        }

        // Add to vector index (fire and forget for now, or await if critical)  
        if (vectorService) {
            vectorService.addVector(newReply.id, 'reply', newReply.text)
                .then(() => logger.info({ ...logContext, replyId: newReply.id }, 'Reply content added to vector index.'))
                .catch(err => logger.error({ ...logContext, replyId: newReply.id, err }, 'Error adding reply content to vector index.'));
        }

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

/**
 * @route   GET /replies/duplicate/:groupId
 * @desc    Get duplicate group with all related replies
 * @access  Public (for now)
 */
router.get<{ groupId: string }>('/duplicate/:groupId', async (req: Request, res: Response) => {
    const { groupId } = req.params;
    const requestId = res.locals.requestId;
    const logContext = { requestId };

    try {
        if (!duplicateDetectionService) {
            logger.error(logContext, 'Duplicate detection service not initialized');
            res.status(503).json({ success: false, error: 'Duplicate detection service unavailable' });
            return;
        }

        const result = await duplicateDetectionService.getDuplicateGroupWithReplies(groupId);
        
        if (!result) {
            logger.warn({ ...logContext, groupId }, 'Duplicate group not found');
            res.status(404).json({ success: false, error: 'Duplicate group not found' });
            return;
        }

        logger.info({ ...logContext, groupId }, 'Successfully retrieved duplicate group');
        res.status(200).json({
            success: true,
            data: {
                originalReply: result.originalReply,
                duplicates: result.duplicates,
                group: result.group
            }
        });
    } catch (err) {
        logger.error({ ...logContext, groupId, err }, 'Error retrieving duplicate group');
        res.status(500).json({ success: false, error: 'Server error retrieving duplicate group' });
    }
});

/**
 * @route   POST /replies/duplicate/:groupId/vote
 * @desc    Vote for a duplicate reply in a group
 * @access  Authenticated
 */
router.post<{ groupId: string }, { success: boolean, error?: string }, { replyId: string }>('/duplicate/:groupId/vote', authenticateToken, async (req: Request, res: Response) => {
    const { groupId } = req.params;
    const { replyId } = req.body;
    const user: User = (req as AuthenticatedRequest).user;
    const requestId = res.locals.requestId;
    const logContext = { requestId, groupId, replyId, userId: user.id };

    try {
        if (!replyId) {
            logger.warn(logContext, 'Missing replyId in vote request');
            res.status(400).json({ success: false, error: 'Missing replyId' });
            return;
        }

        // Fetch the duplicate group to validate the replyId belongs to it
        const duplicateGroup = await db.getDuplicateGroup(groupId);
        if (!duplicateGroup) {
            logger.warn(logContext, 'Duplicate group not found');
            res.status(404).json({ success: false, error: 'Duplicate group not found' });
            return;
        }

        // Check if replyId matches originalReplyId or is in duplicateReplyIds
        const isValidReplyId = duplicateGroup.originalReplyId === replyId || 
                              duplicateGroup.duplicateReplyIds.includes(replyId);
        
        if (!isValidReplyId) {
            logger.warn({ ...logContext, originalReplyId: duplicateGroup.originalReplyId, duplicateReplyIds: duplicateGroup.duplicateReplyIds }, 
                'Invalid replyId for duplicate group');
            res.status(400).json({ success: false, error: 'Reply does not belong to the specified duplicate group' });
            return;
        }

        // Store the user's vote
        await db.setUserDuplicateVote(user.id, groupId, replyId);

        logger.info(logContext, 'Successfully recorded duplicate vote');
        res.status(200).json({ success: true });
    } catch (err) {
        logger.error({ ...logContext, err }, 'Error recording duplicate vote');
        res.status(500).json({ success: false, error: 'Server error recording vote' });
    }
});

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
 * @param   {SortingCriteria} sortCriteria - Sorting order (e.g., 'MOST_RECENT').
 * @query   {number} [limit=10] - Max number of replies per page.
 * @query   {string} [cursor] - Pagination cursor (timestamp_replyId key for zscan).
 * @returns {CursorPaginatedResponse<ReplyData>} Response with replies and pagination.
 */
router.get<{ parentId: string; quote: string; sortCriteria: SortingCriteria }, CursorPaginatedResponse<ReplyData> | { success: boolean; error: string }, Record<string, never>, { limit?: string, cursor?: string, t?:string }>('/getReplies/:parentId/:quote/:sortCriteria', async (req, res) => {
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


        if (!(SortingCriteria[sortCriteria] in SortingCriteria)) {
            res.status(400).json({ success: false, error: 'Invalid sort criteria' });
            return;
        }
                // Get total count (using zCard with mapped key)
        const totalCount = await db.getReplyCountByParentQuote(parentId, hashedQuoteKey, sortCriteria as string) || 0;

        // Fetch reply IDs using zscan for cursor stability
        // FirebaseClient.zscan should handle mapping zSetKey to the index path
        // and using orderByKey().limitToFirst().startAfter(cursor)
        const { items: replyItems, nextCursor: nextCursorRaw } = await db.getReplyIdsByParentQuote(parentId, hashedQuoteKey, sortCriteria as string, limit, cursor);
        // zscan returns { score: number, value: string (replyId) }[]


        // Fetch the actual reply data for each ID using direct path
        const repliesPromises = replyItems.map(async (item: any) => {
            const replyId = item.value; // Reply ID is in the 'value' field
            try {
                // Remove surrounding quotes from replyId if they exist
                const sanitizedReplyId = replyId.replace(/^"|"$/g, '');
                const replyData = await db.getReply(sanitizedReplyId);
                if (replyData) {
                    // Check if this reply is part of a duplicate group
                    let duplicateGroupId = undefined;
                    
                    // Check if this reply is a duplicate reply
                    const duplicateReply = await db.getDuplicateReply(sanitizedReplyId);
                    if (duplicateReply) {
                        duplicateGroupId = duplicateReply.duplicateGroupId;
                    }
                    // Note: We don't check if this is an original reply in a group here 
                    // to avoid expensive lookups. The carousel system works by showing
                    // multiple similar replies as siblings, and the info button will
                    // appear on duplicate replies that have a duplicateGroupId.
                    
                    // Add duplicateGroupId to reply data if found
                    const enrichedReplyData = duplicateGroupId 
                        ? { ...replyData, duplicateGroupId }
                        : replyData;
                    
                    return enrichedReplyData;
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