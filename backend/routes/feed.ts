import { Router } from 'express';
import logger from '../logger.js';
import {
    DatabaseClient as DatabaseClientType,
    FeedItem,
    CompressedApiResponse,
    FeedItemsResponse,
    Compressed
} from '../types/index.js';
import { decodeCursor, createCursor } from '../utils/cursorUtils.js';

// Use the imported type for the placeholder and the setDb function
let db: DatabaseClientType;
export const setDb = (databaseClient: DatabaseClientType) => {
    db = databaseClient;
};

const router = Router();

// Define a type guard function for FeedItem
function isValidFeedItem(item: any): item is FeedItem {
    return (
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.text === 'string' &&
        typeof item.authorId === 'string' &&
        typeof item.createdAt === 'string'
    );
}

/**
 * @route   GET /feed
 * @desc    Get feed data with pagination
 * @access  Public
 */
router.get('/', async (req, res): Promise<void> => {
    const limit = parseInt(req.query.limit as string) || 10;
    // Cursor is now the Firebase push key (string) or undefined for the first page
    const cursorKey = req.query.cursor as string | undefined; 

    logger.info("Handling request for feed with cursorKey %s and limit %d", cursorKey || 'start', limit);

    try {
        // Connection state log might still be misleading, but keep it for now
        logger.info('Current db connection state: %O', {
            connected: await db.isConnected(), // Await the promise
            ready: await db.isReady()       // Await the promise
        });

        // Get total items using the updated lLen
        const totalItems = await db.lLen('feedItems');
        logger.info('Total feed items count: %d', totalItems);

        // Fetch page using the new method
        // We pass returnCompressed: true to avoid double decompression (client + route)
        // The CompressedDatabaseClient handles decompression based on this option.
        const { items, nextCursorKey } = await db.getFeedItemsPage(limit, cursorKey);

        // No need to parse items here, getFeedItemsPage should return objects
        // (FirebaseClient does, RedisClient placeholder parses JSON)
        // Filter/validate items - we might still get non-FeedItem objects?
        const feedItems: FeedItem[] = items.filter(isValidFeedItem);
        if (feedItems.length !== items.length) {
             logger.warn('Some items returned from getFeedItemsPage were not valid FeedItems.');
        }

        logger.info("Fetched feed items: %d items", feedItems.length);

        // Note: prevCursor logic is hard with key-based pagination forward-only
        // We can't easily go back without storing previous keys or changing query direction.
        // Setting prevCursor to undefined for now.
        const data = {
            data: feedItems,
            pagination: {
                nextCursor: nextCursorKey || undefined, // Use the key directly
                prevCursor: undefined, // TODO: Implement prev cursor logic if needed
                hasMore: nextCursorKey !== null,
                totalCount: totalItems
            }
        } as FeedItemsResponse;

        // Compress the final response
        const compressedData = await db.compress(data);
        const response: CompressedApiResponse<Compressed<FeedItemsResponse>> = {
            success: true,
            compressedData: compressedData
        };

        res.setHeader('X-Data-Compressed', 'true');
        res.send(response);
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
