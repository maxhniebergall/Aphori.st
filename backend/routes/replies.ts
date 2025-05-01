import { Router, Request, Response } from 'express';
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
    Compressed
} from '../types/index.js';
import { getQuoteKey } from '../utils/quoteUtils.js';
import { uuidv7obj } from 'uuidv7';
import { Uuid25 } from 'uuid25';

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
router.post('/createReply', async (req: Request, res: Response<CreateReplyResponse>) => {
    try {
        const text: string = req.body.text;
        const parentId: string[] = req.body.parentId;
        const quote: Quote = req.body.quote;
        const user: User = (req as AuthenticatedRequest).user;

        if (!text || !parentId || !quote || !quote.text || !quote.sourceId || !quote.selectionRange) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields. Ensure text, parentId, and a full quote (with text, sourceId, and selectionRange) are provided.'
            });
            return;
        }

        const trimmedText = text.trim();
        const MAX_REPLY_LENGTH = 1000;
        const MIN_REPLY_LENGTH = 50;
        const IGNORE_MIN_REPLY_LENGTH = ["Yes!"];

        if (trimmedText.length > MAX_REPLY_LENGTH) {
            res.status(400).json({
                success: false,
                error: `Reply text exceeds the maximum length of ${MAX_REPLY_LENGTH} characters.`
            });
            return;
        }
        if (!IGNORE_MIN_REPLY_LENGTH.includes(trimmedText) && trimmedText.length < MIN_REPLY_LENGTH) {
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

        await db.hSet(newReply.id, 'reply', newReply);
        const quoteKey = getQuoteKey(quote);
        const score = Date.now();
        const actualParentId = Array.isArray(newReply.parentId) ? newReply.parentId[0] : newReply.parentId;
        const replyId = newReply.id;

        await db.zAdd(`replies:quote:${quoteKey}:mostRecent`, score, replyId);
        await db.zAdd(`replies:uuid:${actualParentId}:quote:${quoteKey}:mostRecent`, score, replyId);
        await db.hIncrementQuoteCount(`${actualParentId}:quoteCounts`, quoteKey, quote);
        await db.sAdd(`user:${user.id}:replies`, replyId);
        await db.zAdd(`replies:${actualParentId}:${quote.text}:mostRecent`, score, replyId);
        await db.zAdd('replies:feed:mostRecent', score, replyId);
        await db.zAdd(`replies:quote:${quote.text}:mostRecent`, score, replyId);

        logger.info('Created new reply with ID: %s for parent: %s', replyId, actualParentId);

        const response: CreateReplyResponse = {
            success: true,
            data: { id: replyId }
        };
        res.send(response);
    } catch (err) {
        logger.error({ err }, 'Error creating reply');
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

export default router;