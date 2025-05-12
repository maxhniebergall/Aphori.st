import { Router, Response, Request } from 'express';
import logger from '../logger.js';
import {
    AuthenticatedRequest,
    Post,
    PostCreationRequest,
    FeedItem
} from '../types/index.js';
import { uuidv7obj } from 'uuidv7';
import { Uuid25 } from 'uuid25';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { LoggedDatabaseClient } from '../db/LoggedDatabaseClient.js';
import { VectorService } from '../services/vectorService.js';

let db: LoggedDatabaseClient;
let vectorService: VectorService;

export const setDb = (databaseClient: LoggedDatabaseClient, vs: VectorService) => {
    db = databaseClient;
    vectorService = vs;
};

const router = Router();

// Helper function to generate compressed 25-digit UUID v7
const generateCondensedUuid = (): string => {
  const uuidObj = uuidv7obj();
  const uuid25Instance = Uuid25.fromBytes(uuidObj.bytes);
  return uuid25Instance.value;
};

// Define a type guard function for Post based on NEW schema
function isValidPost(item: any): item is Post {
    return (
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.content === 'string' &&
        typeof item.authorId === 'string' &&
        typeof item.createdAt === 'string' &&
        typeof item.replyCount === 'number' && item.replyCount >= 0
        // parentId no longer exists on Post
    );
}

/**
 * @route   POST /api/posts/createPost
 * @desc    Creates a new top-level post (story)
 * @access  Authenticated
 */
router.post<{}, any, { postTree: PostCreationRequest }>(
    '/createPost',
    authenticateToken,
    async (req: Request<{}, any, { postTree: PostCreationRequest }>, res: Response<{ id: string } | { error: string }>) => {
        const operationId = generateCondensedUuid()
        const requestId = res.locals.requestId;
        const logContext = { requestId, operationId };

        const authenticatedReq = req as AuthenticatedRequest;
        const user = authenticatedReq.user;

        try {
            // TODO: Adjust req.body access if request structure changes from { postTree: { content: ... } }
            const postContent = req.body.postTree?.content;
            if (!postContent) {
                logger.warn(logContext, 'Missing post content in request');
                res.status(400).json({ error: 'Post content is required' });
                return;
            }

            const trimmedContent = postContent.trim();
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

            // Use new semantic method for atomic post creation
            const uuid = generateCondensedUuid();
            const newPost: Post = {
                id: uuid,
                content: trimmedContent,
                authorId: user.id,
                createdAt: new Date().toISOString(),
                replyCount: 0 // Added replyCount
            };

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

            const feedItem: FeedItem = {
                id: uuid,
                authorId: user.id,
                textSnippet: trimmedContent.substring(0, 100),
                createdAt: newPost.createdAt
            };
            await db.createPostTransaction(newPost, feedItem);

            logger.info({ ...logContext, postId: uuid }, `Successfully created new Post`);

            // Add to vector index (fire and forget for now, or await if critical)
            if (vectorService) {
                vectorService.addVector(newPost.id, 'post', newPost.content)
                    .then(() => logger.info({ ...logContext, postId: newPost.id }, 'Post content added to vector index.'))
                    .catch(err => logger.error({ ...logContext, postId: newPost.id, err }, 'Error adding post content to vector index.'));
            }

            res.status(201).json({ id: uuid }); // Use 201 Created status
        } catch (err) {
            logger.error({ ...logContext, err }, 'Error creating Post');
            res.status(500).json({ error: 'Server error creating post' });
        }
    }
);

/**
 * @route   GET /api/posts/:uuid
 * @desc    Retrieves a single post
 * @access  Public
 */
router.get<{ uuid: string }, Post | { success: boolean; error: string } >('/:uuid', async (req, res) => {
    const { uuid } = req.params;
    const requestId = res.locals.requestId;
    const logContext = { requestId }; // Include requestId for read operations

    if (!uuid) {
        logger.warn(logContext, 'Missing UUID in getPost request');
        res.status(400).json({ success: false, error: 'UUID is required' });
        return;
    }
    try {
        // Use new semantic method
        const postData = await db.getPost(uuid);

        if (!postData) {
            logger.warn({ ...logContext, uuid }, 'Post not found');
            res.status(404).json({ success: false, error: 'Post not found' });
            return;
        }

        if (!isValidPost(postData)) {
            logger.error({ ...logContext, uuid, postData }, 'Invalid post structure retrieved from DB');
            res.status(500).json({ success: false, error: 'Invalid post data retrieved' });
            return;
        }

        // Set Caching Headers
        res.setHeader('Last-Modified', new Date(postData.createdAt).toUTCString());
        // ETag includes replyCount because it's part of the response and can change
        const etagValue = `${postData.id}-${new Date(postData.createdAt).getTime()}-${postData.replyCount}`;
        res.setHeader('ETag', `W/"${etagValue}"`); // Weak ETag
        res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes

        // Check if client's cache is fresh
        if (req.fresh) {
            logger.debug({ ...logContext, uuid }, 'Post cache fresh, sending 304 Not Modified');
            res.status(304).end();
            return;
        }

        logger.debug({ ...logContext, uuid }, 'Sending full post data');
        // Send the post object directly, no compression needed here as it's handled globally
        res.json(postData);

    } catch (error) {
        logger.error({ ...logContext, uuid, err: error }, 'Error in getPost endpoint');
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
