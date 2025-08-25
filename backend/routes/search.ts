import { Router, Request, Response, NextFunction } from 'express';
import logger from '../logger.js';
import { 
    VectorSearchResponse, 
    PostData, 
    ReplyData 
} from '../types/index.js';
import { VectorService } from '../services/vectorService.js';
import { LoggedDatabaseClient } from '../db/LoggedDatabaseClient.js';
import { createVectorError, createValidationError } from '../middleware/errorHandler.js';

let db: LoggedDatabaseClient;
let vectorService: VectorService;

// Function to inject dependencies
export const setDbAndVectorService = (databaseClient: LoggedDatabaseClient, vs: VectorService) => {
    db = databaseClient;
    vectorService = vs;
};

const router = Router();

// Defensive check – fail fast if dependencies were not injected
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!db || !vectorService) {
    logger.error({ requestId: res.locals.requestId }, 'Vector search dependencies not initialised');
    const error = createVectorError('VECTOR_INDEX_UNAVAILABLE', 'Vector search service is not available', res.locals.requestId);
    res.status(503).json({
      success: false,
      results: [],
      ...error
    });
    return;
  }
  next();
});

/**
 * @route   GET /api/search/vector
 * @desc    Performs vector search based on query text with pagination support.
 * @access  Public (for now, consider auth later if needed)
 * @query   {string} query - The search text.
 * @query   {number} [limit] - Number of results per page (default: 10, max: 50).
 * @query   {number} [offset] - Number of results to skip (default: 0).
 * @returns {VectorSearchResponse} Search results with score and original data plus pagination info.
 */
router.get<
    Record<string, never>,
    VectorSearchResponse, 
    Record<string, never>,
    { query?: string; limit?: string; offset?: string } // Specify query parameters type
>('/vector', async (req: Request<{}, VectorSearchResponse, {}, { query?: string; limit?: string; offset?: string }>, res: Response<VectorSearchResponse>) => {
    const { query, limit: limitStr, offset: offsetStr } = req.query;
    const requestId = res.locals.requestId;
    const logContext = { requestId, query, limit: limitStr, offset: offsetStr };

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        logger.warn(logContext, 'Missing or invalid query parameter for vector search');
        const error = createValidationError('Query parameter is required and must be a non-empty string', 'query', requestId);
        res.status(400).json({ 
            success: false, 
            results: [], 
            ...error 
        });
        return;
    }

    // Parse and validate pagination parameters
    const parsedLimit = parseInt(limitStr || '10', 10);
    const parsedOffset = parseInt(offsetStr || '0', 10);
    
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
        logger.warn({ ...logContext, limitStr }, 'Invalid limit parameter for vector search');
        const error = createValidationError('Limit parameter must be a valid integer greater than 0', 'limit', requestId);
        res.status(400).json({ 
            success: false, 
            results: [], 
            ...error 
        });
        return;
    }
    
    if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
        logger.warn({ ...logContext, offsetStr }, 'Invalid offset parameter for vector search');
        const error = createValidationError('Offset parameter must be a valid integer greater than or equal to 0', 'offset', requestId);
        res.status(400).json({ 
            success: false, 
            results: [], 
            ...error 
        });
        return;
    }
    
    const limit = Math.min(50, parsedLimit); // Max 50
    const offset = parsedOffset;
    
    // For vector search, we need to fetch more results than requested to support pagination
    // We'll fetch a larger set and then slice for pagination
    const K_NEIGHBORS = Math.min(200, offset + limit * 3); // Fetch enough for current + some future pages

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

        // Apply pagination to the results
        const totalResults = resultsWithData.length;
        const paginatedResults = resultsWithData.slice(offset, offset + limit);
        const hasMore = offset + limit < totalResults;

        logger.info({ 
            ...logContext, 
            totalFound: totalResults, 
            returnedCount: paginatedResults.length, 
            hasMore,
            offset,
            limit
        }, 'Successfully processed vector search request with pagination.');
        
        // Set Cache-Control header (e.g., cache for 1 minute)
        res.setHeader('Cache-Control', 'public, max-age=60');
        
        res.json({ 
            success: true, 
            results: paginatedResults,
            pagination: {
                offset,
                limit,
                total: totalResults,
                hasMore
            }
        });

    } catch (error) {
        logger.error({ ...logContext, err: error }, 'Error performing vector search');
        const apiError = createVectorError('VECTOR_SEARCH_FAILED', 'Vector search failed due to an internal error', requestId);
        res.status(503).json({ 
            success: false, 
            results: [], 
            ...apiError 
        });
    }
});

export default router; 