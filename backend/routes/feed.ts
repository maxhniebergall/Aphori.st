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
    let cursor = 0;

    if (req.query.cursor) {
        try {
            const decodedCursor = decodeCursor(req.query.cursor as string);
            cursor = parseInt(decodedCursor.id);
        } catch (error) {
            res.status(400).json({ success: false, error: 'Invalid cursor format' });
            return;
        }
    }

    logger.info("Handling request for feed with cursor %d and limit %d", cursor, limit);

    try {
        logger.info('Current db connection state: %O', {
            connected: db.isConnected?.() || 'unknown',
            ready: db.isReady?.() || 'unknown'
        });

        const totalItems = await db.lLen('feedItems');

        if (cursor < 0) {
            res.status(400).json({ success: false, error: 'Cursor cannot be negative' });
            return;
        }
        if (cursor > totalItems) {
            res.status(400).json({ success: false, error: 'Cursor is beyond the end of the feed' });
            return;
        }

        const endIndex = Math.min(cursor + limit, totalItems);

        logger.info('Attempting to fetch feed items from db with range: %O', {
            cursor,
            endIndex,
            key: 'feedItems'
        });

        const fetchedRawItems: unknown = await db.lRange('feedItems', cursor, endIndex - 1, { returnCompressed: false });

        if (!Array.isArray(fetchedRawItems)) {
            throw new Error("Database did not return an array for feed items");
        }

        const parsedItems: FeedItem[] = [];
        for (const rawItem of fetchedRawItems) {
            if (typeof rawItem !== 'string') {
                logger.warn('Found non-string item in feedItems list: %O', rawItem);
                continue;
            }
            try {
                const item = JSON.parse(rawItem);
                if (isValidFeedItem(item)) {
                    parsedItems.push(item);
                } else {
                    logger.warn('Found invalid FeedItem structure after parsing: %O', item);
                }
            } catch (parseError) {
                logger.error('Failed to parse feed item JSON: %s, Error: %O', rawItem, parseError);
            }
        }

        const feedItems: FeedItem[] = parsedItems;
        logger.info("Parsed feed items: %d items", feedItems.length);

        const data = {
            data: feedItems,
            pagination: {
                nextCursor: endIndex < totalItems ? createCursor(endIndex.toString(), Date.now(), 'story') : undefined,
                prevCursor: cursor > 0 ? createCursor(Math.max(0, cursor - limit).toString(), Date.now(), 'story') : undefined,
                hasMore: endIndex < totalItems,
                totalCount: totalItems
            }
        } as FeedItemsResponse;

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
