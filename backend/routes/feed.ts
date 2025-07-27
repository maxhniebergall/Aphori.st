import { Router } from 'express';
import logger from '../logger.js';
import {
    FeedItem,
    FeedItemsResponse,
    ApiError
} from '../types/index.js';
import { LoggedDatabaseClient } from '../db/LoggedDatabaseClient.js';
let db: LoggedDatabaseClient;
export const setDb = (databaseClient: LoggedDatabaseClient) => {
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
router.get<'/', FeedItemsResponse | ApiError, any, { limit?: string, cursor?: string, t?: string }>('/', async (req, res): Promise<void> => {
    const limit = parseInt(req.query.limit as string) || 3;
    // Cursor is now the Firebase push key (string) or undefined for the first page
    const cursorKey = req.query.cursor as string | undefined;
    const timeBucket = req.query.t as string | undefined; // Read the timeBucket parameter

    try {

        // Get total items using the new semantic method
        const totalItems = await db.getGlobalFeedItemCount();
        logger.info('Total feed items count: %d', totalItems);

        // Fetch page using the new semantic method
        const { items, nextCursorKey } = await db.getGlobalFeedItemsPage(limit, cursorKey);

        // Filter/validate items - ensure they match the FeedItem structure
        const feedItems: FeedItem[] = items.filter(isValidFeedItem);
        if (feedItems.length !== items.length) {
             logger.warn('Some items returned from getFeedItemsPage were not valid FeedItems according to the new schema.');
        }

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

        // Set Cache-Control header
        res.setHeader('Cache-Control', 'public, max-age=60');

        // Send plain JSON response
        res.json(responseData);

    } catch (error) {
        logger.error({ err: error }, 'Error fetching feed items');
        const apiError: ApiError = { error: 'Internal Server Error', message: 'Internal server error' };
        res.status(500).json(apiError);
    }
});

export default router;