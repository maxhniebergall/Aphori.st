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
        const operationId = randomUUID();
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

            const uuid = generateCondensedUuid();
            const newPost: Post = {
                id: uuid,
                content: trimmedContent,
                authorId: user.id,
                createdAt: new Date().toISOString(),
                replyCount: 0 // Added replyCount
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

            // Store post at /posts/$postId
            await db.set(`posts/${uuid}`, newPost, logContext);

            // Add post ID to relevant sets/indexes
            await db.sAdd('allPostTreeIds:all', uuid, logContext); // Add to global post set
            await db.sAdd(`userPosts:${user.id}`, uuid, logContext); // Add to user's post set

            // Add to feed items
            const feedItem: FeedItem = {
                id: uuid,
                authorId: user.id,
                textSnippet: trimmedContent.substring(0, 100), // Use textSnippet
                createdAt: newPost.createdAt
            };
            await db.lPush('feedItems', feedItem, logContext); // Pass object, not string
            await db.incrementFeedCounter(1, logContext); // Increment feed counter

            logger.info({ ...logContext, postId: uuid }, `Successfully created new Post`);
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
        // Get post directly from /posts/$uuid
        const postData = await db.get<Post>(`posts/${uuid}`, logContext);

        if (!postData) {
            logger.warn({ ...logContext, uuid }, 'Post not found');
            res.status(404).json({ success: false, error: 'Post not found' });
            return;
        }

        // Optional: Validate structure just in case? Depends on trust in DB rules.
        if (!isValidPost(postData)) {
            logger.error({ ...logContext, uuid, postData }, 'Invalid post structure retrieved from DB');
            // Don't expose potentially sensitive invalid data
            res.status(500).json({ success: false, error: 'Invalid post data retrieved' });
            return;
        }

        // Send the post object directly, no compression
        res.json(postData);

    } catch (error) {
        logger.error({ ...logContext, uuid, err: error }, 'Error in getPost endpoint');
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
