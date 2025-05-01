import { Router, RequestHandler, Response } from 'express';
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
 * @route   POST /posts/createPostTree
 * @desc    Create a new root post (story tree)
 * @access  Authenticated
 */
router.post('/createPostTree', ((async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { postTree } = req.body as { postTree: PostCreationRequest };
        if (!postTree || !postTree.content) {
            res.status(400).json({ error: 'PostTree data with content is required' });
            return;
        }

        const trimmedContent = postTree.content.trim();

        const MAX_POST_LENGTH = 5000;
        const MIN_POST_LENGTH = 100;
        if (trimmedContent.length > MAX_POST_LENGTH) {
            res.status(400).json({ error: `Post content exceeds the maximum length of ${MAX_POST_LENGTH} characters.` });
            return;
        }
        if (trimmedContent.length < MIN_POST_LENGTH) {
            res.status(400).json({ error: `Post content must be at least ${MIN_POST_LENGTH} characters long.` });
            return;
        }

        const uuid = generateCondensedUuid();

        const formattedPostTree: Post = {
            id: uuid,
            content: trimmedContent,
            parentId: null,
            authorId: req.user.id,
            createdAt: new Date().toISOString(),
        };

        // Store in Redis
        await db.hSet(uuid, 'postTree', JSON.stringify(formattedPostTree));
        await db.lPush('allPostTreeIds', uuid);
        await db.sAdd(`user:${req.user.id}:posts`, uuid);

        const feedItem: FeedItem = {
            id: uuid,
            text: trimmedContent,
            authorId: req.user.id,
            createdAt: formattedPostTree.createdAt
        };
        await db.lPush('feedItems', JSON.stringify(feedItem));
        logger.info('Added feed item for story %s', uuid);

        logger.info('Created new PostTree with UUID: %s', uuid);
        res.json({ id: uuid });
    } catch (err) {
        logger.error({ err }, 'Error creating PostTree');
        res.status(500).json({ error: 'Server error' });
    }
}) as unknown as RequestHandler));

/**
 * @route   GET /posts/:uuid
 * @desc    Retrieves a post (top level postTree element)
 * @access  Public
 */
router.get<{ uuid: string }, CompressedApiResponse<Compressed<Post>>>('/:uuid', async (req, res) => {
    const { uuid } = req.params;
    if (!uuid) {
        res.status(400).json({ success: false, error: 'UUID is required' });
        return;
    }
    try {
        let maybePostString = await db.hGet(uuid, 'postTree', { returnCompressed: false });
        if (!maybePostString || typeof maybePostString !== 'string') {
            res.status(404).json({ success: false, error: 'Node not found or invalid format' });
            return;
        }

        let maybePost: any;
        try {
            maybePost = JSON.parse(maybePostString);
        } catch (parseError) {
            logger.error({ postString: maybePostString, err: parseError }, 'Failed to parse post JSON');
            res.status(500).json({ success: false, error: 'Failed to parse post data' });
            return;
        }

        if (!isValidPost(maybePost)) {
            logger.error({ post: maybePost }, 'Invalid post structure returned from database');
            res.status(500).json({ success: false, error: 'Invalid post data' });
            return;
        }

        const post = await db.compress(maybePost) as Compressed<Post>;

        const response: CompressedApiResponse<Compressed<Post>> = {
            success: true,
            compressedData: post
        };
        res.setHeader('X-Data-Compressed', 'true');
        res.send(response);
    } catch (error) {
        logger.error({ err: error }, 'Error in getPost endpoint');
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

export default router;
