import { Router, Response, Request } from 'express';
import logger from '../logger.js';
import {
    DatabaseClient as DatabaseClientType,
    AuthenticatedRequest,
    Post,
    PostCreationRequest,
    FeedItem,
    CompressedApiResponse,
    Compressed
} from '../types/index.js';
import { uuidv7obj } from 'uuidv7';
import { Uuid25 } from 'uuid25';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { randomUUID } from 'crypto';

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

// Define a type guard function for Post
function isValidPost(item: any): item is Post {
    return (
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.content === 'string' &&
        typeof item.authorId === 'string' &&
        typeof item.createdAt === 'string'
    );
}

/**
 * @route   POST /api/posts/createPostTree
 * @desc    Creates a new top-level post (story)
 * @access  Authenticated
 */
router.post<{}, { id: string }, { postTree: PostCreationRequest }>(
    '/createPostTree',
    authenticateToken,
    async (req: Request<{}, { id: string }, { postTree: PostCreationRequest }>, res: Response) => {
        const operationId = randomUUID();
        const requestId = res.locals.requestId;
        const logContext = { requestId, operationId };

        const authenticatedReq = req as AuthenticatedRequest;
        const user = authenticatedReq.user;

        try {
            const { postTree } = req.body;
            if (!postTree || !postTree.content) {
                logger.warn(logContext, 'Missing postTree content in request');
                res.status(400).json({ error: 'PostTree data with content is required' });
                return;
            }

            const trimmedContent = postTree.content.trim();
            const MAX_POST_LENGTH = 5000;
            const MIN_POST_LENGTH = 100;

            if (trimmedContent.length > MAX_POST_LENGTH) {
                 logger.warn({ ...logContext, contentLength: trimmedContent.length }, 'Post content exceeds maximum length');
                res.status(400).json({ error: `Post content exceeds the maximum length of ${MAX_POST_LENGTH} characters.` });
                return;
            }
            if (trimmedContent.length < MIN_POST_LENGTH) {
                logger.warn({ ...logContext, contentLength: trimmedContent.length }, 'Post content below minimum length');
                res.status(400).json({ error: `Post content must be at least ${MIN_POST_LENGTH} characters long.` });
                return;
            }

            const uuid = generateCondensedUuid();
            const formattedPostTree: Post = {
                id: uuid,
                content: trimmedContent,
                parentId: null,
                authorId: user.id,
                createdAt: new Date().toISOString(),
            };

            // Log action intent before DB calls
            logger.info(
                { 
                    ...logContext,
                    action: {
                        type: 'CREATE_POST',
                        params: {
                            postId: uuid,
                            authorId: user.id,
                            contentLength: trimmedContent.length,
                        }
                    },
                },
                'Initiating CreatePost action'
            );

            // Store in Redis with logging context
            await db.hSet(uuid, 'postTree', JSON.stringify(formattedPostTree), logContext);
            await db.lPush('allPostTreeIds', uuid, logContext);
            await db.sAdd(`user:${user.id}:posts`, uuid, logContext);

            // Add to feed items with logging context
            const feedItem: FeedItem = {
                id: uuid,
                text: trimmedContent, // Use trimmed content for feed item as well
                authorId: user.id,
                createdAt: formattedPostTree.createdAt
            };
            // Assuming lPush is the correct method based on server.ts logic
            await db.lPush('feedItems', JSON.stringify(feedItem), logContext);

            logger.info({ ...logContext, postId: uuid }, `Successfully created new PostTree`);
            res.json({ id: uuid });
        } catch (err) {
            logger.error({ ...logContext, err }, 'Error creating PostTree');
            res.status(500).json({ error: 'Server error' });
        }
    }
);

/**
 * @route   GET /api/posts/:uuid
 * @desc    Retrieves a post, a top level postTree element
 * @access  Public
 */
router.get<{ uuid: string }, CompressedApiResponse<Compressed<Post>>>('/:uuid', async (req, res) => {
    const { uuid } = req.params;
    const requestId = res.locals.requestId;
    const logContext = { requestId }; // Include requestId for read operations

    if (!uuid) {
        logger.warn(logContext, 'Missing UUID in getPost request');
        res.status(400).json({ success: false, error: 'UUID is required' });
        return; 
    }
    try {
        let maybePostString = await db.hGet(uuid, 'postTree', { returnCompressed: false }, logContext);
        
        if (!maybePostString || typeof maybePostString !== 'string') {
            logger.warn({ ...logContext, uuid }, 'Post not found or invalid format');
            res.status(404).json({ success: false, error: 'Node not found or invalid format' });
            return;
        }

        let maybePost: any;
        try {
            maybePost = JSON.parse(maybePostString);
        } catch (parseError) {
            logger.error({ ...logContext, uuid, err: parseError, rawData: maybePostString }, 'Failed to parse post JSON');
            res.status(500).json({ success: false, error: 'Failed to parse post data' });
            return;
        }

        // Basic validation - consider adding a proper type guard
        if (!(typeof maybePost === 'object' && maybePost.id && maybePost.content)) {
            logger.error({ ...logContext, uuid, postData: maybePost }, 'Invalid post structure retrieved');
            res.status(500).json({ success: false, error: 'Invalid post data retrieved' });
            return;
        }
        
        const post = await db.compress(maybePost) as Compressed<Post>; // Assuming compress doesn't need context
    
        const apiResponse: CompressedApiResponse<Compressed<Post>> = {
            success: true,
            compressedData: post
        };
        res.setHeader('X-Data-Compressed', 'true');
        res.send(apiResponse);
    } catch (error) {
        logger.error({ ...logContext, uuid, err: error }, 'Error in getPost endpoint');
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
