import { Router, Request, Response } from 'express';
import logger from '../logger.js';
import { 
    VectorSearchResponse, 
    PostData, 
    ReplyData 
} from '../types/index.js';
import { VectorService } from '../services/vectorService.js';
import { LoggedDatabaseClient } from '../db/LoggedDatabaseClient.js';

let db: LoggedDatabaseClient;
let vectorService: VectorService;

// Function to inject dependencies
export const setDbAndVectorService = (databaseClient: LoggedDatabaseClient, vs: VectorService) => {
    db = databaseClient;
    vectorService = vs;
};

const router = Router();

/**
 * @route   GET /api/search/vector
 * @desc    Performs vector search based on query text.
 * @access  Public (for now, consider auth later if needed)
 * @query   {string} query - The search text.
 * @returns {VectorSearchResponse} Search results with score and original data.
 */
router.get<
    {},
    VectorSearchResponse, 
    {},
    { query?: string } // Specify query parameters type
>('/vector', async (req: Request<{}, VectorSearchResponse, {}, { query?: string }>, res: Response<VectorSearchResponse>) => {
    const { query } = req.query;
    const requestId = res.locals.requestId;
    const logContext = { requestId, query };

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        logger.warn(logContext, 'Missing or invalid query parameter for vector search');
        res.status(400).json({ success: false, results: [], error: 'Missing or invalid query parameter.' });
        return;
    }

    const K_NEIGHBORS = 10; // Fixed number of results as per design doc

    try {
        logger.debug(logContext, `Performing vector search for k=${K_NEIGHBORS}`);

        // 1. Search for nearest neighbor IDs and types using VectorService
        const searchResults = await vectorService.searchVectors(query, K_NEIGHBORS);

        if (!searchResults || searchResults.length === 0) {
            logger.info(logContext, 'Vector search returned no results.');
            res.json({ success: true, results: [] });
            return;
        }

        logger.info(logContext, `Vector search found ${searchResults.length} potential matches.`);

        // 2. Fetch full data for each result ID based on its type
        const resultsWithDataPromises = searchResults.map(async (result) => {
            try {
                let data: PostData | ReplyData | null = null;
                if (result.type === 'post') {
                    data = await db.getPost(result.id); // Assuming LoggedDatabaseClient wraps getPost
                } else if (result.type === 'reply') {
                    data = await db.getReply(result.id); // Assuming LoggedDatabaseClient wraps getReply
                }

                if (data) {
                    return {
                        id: result.id,
                        type: result.type,
                        score: result.score,
                        data: data,
                    };
                } else {
                    logger.warn({ ...logContext, contentId: result.id, contentType: result.type }, 'Content data not found for vector search result ID.');
                    return null; // Filter out results where data fetch failed
                }
            } catch (fetchError) {
                logger.error({ ...logContext, contentId: result.id, contentType: result.type, err: fetchError }, 'Error fetching content data for vector search result.');
                return null; // Filter out results where data fetch failed
            }
        });

        const resultsWithData = (await Promise.all(resultsWithDataPromises))
                                .filter(r => r !== null) as VectorSearchResponse['results'];

        logger.info({ ...logContext, returnedCount: resultsWithData.length }, 'Successfully processed vector search request.');
        
        // Set Cache-Control header (e.g., cache for 1 minute)
        res.setHeader('Cache-Control', 'public, max-age=60');
        
        res.json({ success: true, results: resultsWithData });

    } catch (error) {
        logger.error({ ...logContext, err: error }, 'Error performing vector search');
        res.status(500).json({ success: false, results: [], error: 'Internal server error during vector search.' });
    }
});

export default router; 