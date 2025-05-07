import { Router } from 'express';
import logger from '../logger.js';
import {
    DatabaseClient as DatabaseClientType,
    FeedItem,
    FeedItemsResponse,
} from '../types/index.js';

// Use the imported type for the placeholder and the setDb function
let db: DatabaseClientType;
export const setDb = (databaseClient: DatabaseClientType) => {
    db = databaseClient;
};

const router = Router();

// Define a type guard function for FeedItem (based on new model)
function isValidFeedItem(item: any): item is FeedItem {
    return (
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' && // Post ID
        typeof item.authorId === 'string' &&
        typeof item.textSnippet === 'string' && // Check for snippet
        typeof item.createdAt === 'string'
    );
}

/**
 * @route   GET /feed
 * @desc    Get feed data with pagination
 * @access  Public
 */
router.get<'/', FeedItemsResponse | { success: boolean; error: string }>('/', async (req, res): Promise<void> => {
    const limit = parseInt(req.query.limit as string) || 10;
    // Cursor is now the Firebase push key (string) or undefined for the first page
    const cursorKey = req.query.cursor as string | undefined;

    logger.info("Handling request for feed with cursorKey %s and limit %d", cursorKey || 'start', limit);

    try {

        // Get total items using the updated lLen (reads feedStats/itemCount)
        const totalItems = await db.lLen('feedItems');
        logger.info('Total feed items count: %d', totalItems);

        // Fetch page using the new method
        const { items, nextCursorKey } = await db.getFeedItemsPage(limit, cursorKey);

        // Filter/validate items - ensure they match the FeedItem structure
        const feedItems: FeedItem[] = items.filter(isValidFeedItem);
        if (feedItems.length !== items.length) {
             logger.warn('Some items returned from getFeedItemsPage were not valid FeedItems according to the new schema.');
        }

        logger.info("Fetched feed items: %d items", feedItems.length);

        // Prepare response data (no compression)
        const responseData: FeedItemsResponse = {
            data: feedItems,
            pagination: {
                nextCursor: nextCursorKey || undefined, // Use the key directly
                prevCursor: undefined, // prev cursor logic not implemented
                hasMore: nextCursorKey !== null,
                totalCount: totalItems
            }
        };

        // Send plain JSON response
        res.json(responseData);

    } catch (error) {
        if (error instanceof Error) {
            logger.error({ err: error }, 'Error fetching feed items');
            res.status(500).json({ success: false, error: 'Internal server error' });
        } else {
            logger.error({ error }, 'Unknown error fetching feed items');
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }
});

export default router;
