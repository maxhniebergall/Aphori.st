/* requirements
- getUserById checks id with tolowercase
- Accepts development token in non-production environments
- Handles quote metadata in story creation and retrieval
- Stores quote data with source post ID and selection range
- Creates posts (storyTrees) with new schema structure separating posts from replies
- Handles reply creation with quote references and parent tracking
- Creates formatted story trees with metadata and node structure
- Manages feed items for root-level posts only
- Fetches and returns compressed storyTree objects from Redis
- Supports retrieving individual replies by UUID
- Fetches replies by post UUID and quote
- Supports sorting replies by different criteria
- Returns compressed reply data from Redis
- Provides API endpoints for getting replies by UUID, quote, and sorting criteria
- Supports reply feed retrieval sorted by recency
- Uses zAdd to maintain sorted sets for replies
- Handles null/empty responses from Firebase for zRange and zCard operations
- Maintains compatibility with both Redis and Firebase implementations
- Maintains quote reply counts using hash storage for efficient retrieval
- Reads old format of quote reply counts, migrates to new format, and replaces old format in database
- Implements combined node endpoint for unified node structure with backward compatibility and updated compression handling

- TODO:
  - Seperate user + email functions into a seperate file
  - Seperate post + reply functions into a seperate files
    - seperate create and get files
  - Seperate feed (post + reply) functions into a seperate file
*/

import express, { Request, Response, NextFunction, RequestHandler } from "express";
import { createDatabaseClient } from './db/index.js';
import newLogger from './logger.js';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { sendEmail } from './mailer.js';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { seedDevStories } from './seed.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { 
    DatabaseClient, 
    User, 
    ExistingUser,
    UserResult, 
    StoryTree, 
    Reply, 
    FeedItem,
    AuthenticatedRequest,
    ApiResponse,
    CursorPaginatedResponse,
    TokenPayload,
    AuthTokenPayload,
    Quote,
    UnifiedNode,
    Replies,
    ExistingSelectableQuotes,
    UnifiedNodeMetadata
} from './types/index.js';
import { getQuoteKey } from './utils/quoteUtils.js';

dotenv.config();

const PORT = process.env.PORT || 5050;
const logger = newLogger("server.js");

// Load build hash
let BUILD_HASH = 'development';
try {
    const buildEnv = fs.readFileSync('.env.build', 'utf8');
    BUILD_HASH = buildEnv.split('=')[1].trim();
    logger.info(`Loaded build hash: ${BUILD_HASH}`);
} catch (err) {
    logger.warn('No build hash found, using development');
}

const app = express();
app.use(express.json());

// Trust proxy - required for rate limiting behind Cloud Run
app.set('trust proxy', 1);

// Parse the CORS_ORIGIN environment variable into an array and merge with default origins
const defaultOrigins = [
  'https://aphorist.firebaseapp.com',
  'https://aphorist.web.app',
  'https://aphori.st',
  'https://www.aphori.st'
];

// Add development origins only in non-production
if (process.env.NODE_ENV !== 'production') {
  defaultOrigins.push('http://localhost:3000');
  defaultOrigins.push('http://localhost:5050');
}

// Parse CORS origins from environment variable
const envOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()) : [];
const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

logger.info('Configured CORS origins: %O', allowedOrigins);

// Configure CORS using the official middleware
const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Frontend-Hash'],
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Set build hash after CORS headers
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Build-Hash', BUILD_HASH);
  next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db: DatabaseClient = createDatabaseClient();

let isDbReady = false;

// Database readiness check
app.use((req: Request, res: Response, next: NextFunction): void => {
    if (!isDbReady) {
        logger.warn('Database not ready, returning 503');
        res.status(503).json({ 
            error: 'Service initializing, please try again in a moment'
        });
        return;
    }
    next();
});

await db.connect().then(() => {
    logger.info('Database client connected');
    isDbReady = true;
    // Only seed development stories in non-production environments
    if (process.env.NODE_ENV !== 'production') {
        logger.info('Development environment detected, seeding default stories...');
        seedDevStories(db);
    } else {
        logger.info('Production environment detected, skipping dev seed');
    }
}).catch((err: Error) => {
    logger.error('Database connection failed: %O', err);
    process.exit(1);
});

const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        res.status(401).json({ error: 'Token required.' });
        return;
    }

    // In development, accept the dev token
    if (process.env.NODE_ENV !== 'production' && token === 'dev_token') {
        (req as AuthenticatedRequest).user = {
            id: 'dev_user',
            email: 'dev@aphori.st'
        };
        next();
        return;
    }

    if (!process.env.AUTH_TOKEN_SECRET) {
        res.status(500).json({ error: 'Auth token secret not configured.' });
        return;
    }

    jwt.verify(token, process.env.AUTH_TOKEN_SECRET, (err: jwt.VerifyErrors | null, decoded: any) => {
        if (err) {
            res.status(403).json({ error: 'Invalid token.' });
            return;
        }
        (req as AuthenticatedRequest).user = decoded as User;
        next();
    });
};

// Get feed data with pagination
app.get('/api/feed', async (req: Request, res: Response): Promise<void> => {
    // TODO fix pagination
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = 10; // Number of items per page
    logger.info("Handling request for feed at page "+page);
    
    try {
        logger.info('Current db connection state: %O', {
            connected: db.isConnected?.() || 'unknown',
            ready: db.isReady?.() || 'unknown'
        });

        // Fetch all feed items from db with pagination
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;

        logger.info('Attempting to fetch feed items from db with range: %O', {
            startIndex,
            endIndex,
            key: 'feedItems'
        });

        const compressedResults = await db.lRange('feedItems', startIndex, endIndex, { returnCompressed: true }); 
        logger.info('Raw db response for feed items: %O', compressedResults);

        if (!Array.isArray(compressedResults)) {
            logger.error('db error when fetching feed: invalid response format');
            res.status(500).json({ error: 'Error fetching data from Redis' });
            return;
        }

        // Decompress each item in the results array
        const decompressedItems = await Promise.all(
            compressedResults.map((item: any) => db.decompress(item))
        );
        logger.info('Decompressed feed items: %O', decompressedItems);

        // Create the response object
        const response = {
            page,
            items: decompressedItems,
            // totalItems,
            // totalPages: Math.ceil(totalItems / itemsPerPage)
        };
        logger.info('Response object: %O', response);
        
        // Compress the final response
        const compressedResponse = await db.compress(response);

        // Add compression header to indicate data is compressed
        res.setHeader('X-Data-Compressed', 'true');
        res.send(compressedResponse);
    } catch (error) {
        if (error instanceof Error) {
            logger.error('Error fetching feed items: %O', {
                error: error.message,
                stack: error.stack,
                message: error.message
            });
        } else {
            logger.error('Unknown error fetching feed items');
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// Constants for user-related keys
const USER_PREFIX = 'user';
const USER_IDS_SET = 'user_ids';
const EMAIL_TO_ID_PREFIX = 'email_to_id';

const getUserById = async (id: string): Promise<UserResult> => {
    const userData = await db.hGet(db.encodeKey(id, USER_PREFIX), 'data');
    if (!userData) {
        return {
            success: false,
            error: 'User not found'
        };
    }
    return {
        success: true,
        data: userData // Already decompressed by the client
    };
};

const getUserByEmail = async (email: string): Promise<UserResult> => {
    // Get user ID from email mapping
    const userId = await db.get(db.encodeKey(email.toLowerCase(), EMAIL_TO_ID_PREFIX));
    if (!userId) {
        return {
            success: false,
            error: 'User not found'
        };
    }

    const userResult = await getUserById(userId);
    if (!userResult.success || !userResult.data) {
        return userResult;
    }

    return {
        success: true,
        data: {
            ...userResult.data,
        }
    };
};

const createUser = async (id: string, email: string): Promise<UserResult> => {
    // Check if ID is taken
    const existingUser = await getUserById(id);
    if (existingUser.success) {
        return {
            success: false,
            error: 'User ID already exists'
        };
    }

    // Check if email is already registered
    const existingEmail = await db.get(db.encodeKey(email, EMAIL_TO_ID_PREFIX));
    if (existingEmail) {
        return {
            success: false,
            error: 'Email already registered'
        };
    }

    const newUser: ExistingUser = {
        id,
        email,
        createdAt: new Date().toISOString()
    };

    try {
        // Store user data
        await db.hSet(db.encodeKey(id, USER_PREFIX), 'data', newUser);
        // Add ID to set of user IDs
        await db.sAdd(USER_IDS_SET, id);
        // Create email to ID mapping
        await db.set(db.encodeKey(email, EMAIL_TO_ID_PREFIX), id);

        return {
            success: true,
            data: newUser
        };
    } catch (error) {
        logger.error('Database error creating user:', error);
        return {
            success: false,
            error: 'Server error creating user'
        };
    }
};

// Helper Functions
const generateMagicToken = (email: string): string => {
    if (!process.env.MAGIC_LINK_SECRET) {
        throw new Error('Magic link secret not configured');
    }
    return jwt.sign(
        { email } as TokenPayload,
        process.env.MAGIC_LINK_SECRET,
        { expiresIn: '15m' } // Magic link valid for 15 minutes
    );
};

const generateAuthToken = (user: User): string => {
    if (!process.env.AUTH_TOKEN_SECRET) {
        throw new Error('Auth token secret not configured');
    }
    return jwt.sign(
        { id: user.id, email: user.email } as AuthTokenPayload,
        process.env.AUTH_TOKEN_SECRET,
        { expiresIn: '7d' } // Auth token valid for 7 days
    );
};

// Apply to magic link route
const magicLinkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 5 requests per windowMs
    message: 'Too many magic link requests from this IP, please try again later.',
});

// Routes

/**
 * @route   POST /api/auth/send-magic-link
 * @desc    Sends a magic link to the user's email for authentication
 * @access  Public
 */
app.post('/api/auth/send-magic-link', magicLinkLimiter, async (req: Request, res: Response): Promise<void> => {
    const { email, isSignupInRequest } = req.body;

    // Validate email
    if (!email) {
        logger.error('Missing email in request body');
        res.status(400).json({ 
            success: false,
            error: 'Email is required'
        });
        return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        logger.error(`Invalid email format: ${email}`);
        res.status(400).json({ 
            success: false,
            error: 'Invalid email format'
        });
        return;
    }

    try {
        // Check if user exists
        const userResult = await getUserByEmail(email);
        const isSignup = isSignupInRequest === true || userResult?.error === 'User not found'; // If user doesn't exist, we're doing a signup
        logger.info("Server: send-magic-link request", req.body, "isSignup: ", isSignup, "userResult: ", userResult);
        
        let token;
        if (process.env.NODE_ENV == 'production') {
            // Generate magic token
            token = generateMagicToken(email);
        } else {
            // In development, accept the dev token
            token = 'dev_token';
        }
            
        // If isSignup is true, redirect to signup page instead of verify
        const baseUrl = isSignup ? 'https://aphori.st/signup' : 'https://aphori.st/verify';
        const magicLink = `${baseUrl}?token=${token}&email=${encodeURIComponent(email)}`;

        // Email content
        const subject = isSignup ? 'Complete Your Sign Up' : 'Your Magic Link to Sign In';
        const actionText = isSignup ? 'complete your sign up' : 'sign in';
        const html = `
            <p>Hi,</p>
            <p>Click <a href="${magicLink}">here</a> to ${actionText}. This link will expire in 15 minutes.</p>
            <p>If you did not request this email, you can safely ignore it.</p>
            <p>Thanks,<br/>Aphori.st Team</p>
        `;

        await sendEmail(email, subject, html);
        logger.info(`Magic link sent successfully to: ${email}`);
        res.json({ 
            success: true,
            message: 'Magic link sent to your email'
        });
    } catch (error) {
        logger.error('Failed to send magic link:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to send magic link'
        });
    }
});

/**
 * @route   POST /api/auth/verify-magic-link
 * @desc    Verifies the magic link token and authenticates the user
 * @access  Public
 */
app.post('/api/auth/verify-magic-link', async (req: Request, res: Response): Promise<void> => {
    const { token } = req.body;
    logger.info('Received verify-magic-link request with token:', token);

    if (!token) {
        logger.warn('No token provided in request');
        res.status(400).json({ 
            success: false,
            error: 'Token is required'
        });
        return;
    }

    try {
        logger.info('Attempting to verify JWT token');
        if (!process.env.MAGIC_LINK_SECRET) {
            throw new Error('Magic link secret not configured');
        }
        const decoded = jwt.verify(token, process.env.MAGIC_LINK_SECRET);
        logger.info('Successfully decoded token:', decoded);
        if (typeof decoded !== 'object' || !decoded.email) {
            throw new Error('Invalid token payload');
        }

        logger.info('Looking up user by email:', decoded.email);
        const userResult = await getUserByEmail(decoded.email);
        logger.info('User lookup result:', userResult);

        if (!userResult.success) {
            logger.warn('User not found for email:', decoded.email);
            res.status(300).json({ 
                success: false,
                error: 'User not found',
                email: decoded.email
            });
            return;
        }

        // Generate auth token
        logger.info('Generating auth token for user:', userResult.data);
        if (!userResult.data) {
            throw new Error('User data not found');
        }
        const authToken = generateAuthToken(userResult.data);

        logger.info('Successfully verified magic link for user:', userResult.data.id);
        res.json({ 
            success: true,
            data: {
                token: authToken,
                user: {
                    id: userResult.data.id,
                    email: userResult.data.email
                }
            }
        });
    } catch (error) {
        if (error instanceof Error) {
            logger.error('Error verifying magic link:', {
                error: error.message,
                name: error.name,
                stack: error.stack,
                token
            });
        } else {
            logger.error('Unknown error verifying magic link', error);
        }
        res.status(400).json({ 
            success: false,
            error: 'Invalid or expired token'
        });
    }
});

/**
 * @route   POST /api/auth/verify-token
 * @desc    Verifies the authentication token
 * @access  Public
 */
app.post('/api/auth/verify-token', async (req: Request, res: Response): Promise<void> => {
    const { token } = req.body;

    if (!token) {
        res.status(400).json({ 
            success: false,
            error: 'Token is required'
        });
        return;
    }

    // In development, accept the dev token
    if (process.env.NODE_ENV !== 'production' && token === 'dev_token') {
        res.json({ 
            success: true,
            data: {
                id: 'dev_user',
                email: 'dev@example.com'
            }
        });
        return;
    }

    try {
        if (!process.env.AUTH_TOKEN_SECRET) {
            throw new Error('Auth token secret not configured');
        }
        const decoded = jwt.verify(token, process.env.AUTH_TOKEN_SECRET) as AuthTokenPayload;
        const userResult = await getUserById(decoded.id);

        if (!userResult.success) {
            res.status(400).json({ 
                success: false,
                error: 'Invalid token'
            });
            return;
        }

        res.json({ 
            success: true,
            data: {
                id: decoded.id,
                email: decoded.email
            }
        });
    } catch (error) {
        logger.error('Token verification failed:', error);
        res.status(400).json({ 
            success: false,
            error: 'Invalid or expired token'
        });
    }
});

// TODO: add user profiles
// app.get('/api/profile', authenticateToken, (req: Request, res: Response): void => {
//     const user = users.find(u => u.id === req.user.id);
//     if (!user) {
//         res.status(404).json({ error: 'User not found.' });
//         return;
//     }

//     res.json({ id: user.id, email: user.email });
// });

app.get('/health', (req: Request, res: Response): void => {
    res.status(200).json({ status: 'healthy' });
});

app.post('/api/createStoryTree', authenticateToken, ((async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { storyTree } = req.body;
        if (!storyTree) {
            res.status(400).json({ error: 'StoryTree data is required' });
            return;
        }

        // Generate a new UUID for the story tree
        const uuid = crypto.randomUUID();
        
        // Create the full object following new schema structure
        const formattedStoryTree = {
            id: uuid,
            text: storyTree.content || storyTree.text,
            parentId: null, // Root-level posts always have null parentId
            metadata: {
                authorId: req.user.id,
                createdAt: new Date().toISOString(),
                quote: null // Root-level posts don't have quotes
            },
        } as StoryTree;

        // Store in Redis
        await db.hSet(uuid, 'storyTree', JSON.stringify(formattedStoryTree));
        await db.lPush('allStoryTreeIds', uuid);

        // Add to feed items (only root-level posts go to feed)
        const feedItem = {
            id: uuid,
            text: storyTree.content || storyTree.text,
            authorId: req.user.id,
            createdAt: formattedStoryTree.metadata.createdAt
        } as FeedItem;
        await db.lPush('feedItems', JSON.stringify(feedItem));
        logger.info(`Added feed item for story ${JSON.stringify(feedItem)}`);

        logger.info(`Created new StoryTree with UUID: ${uuid}`);
        res.json({ id: uuid });
    } catch (err) {
        logger.error('Error creating StoryTree:', err);
        res.status(500).json({ error: 'Server error' });
    }
}) as unknown as RequestHandler)); // TODO: fix this, we should be able to use the correct type directly

/**
 * @route   GET /api/check-user-id/:id
 * @desc    Check if a user ID is available
 * @access  Public
 */
app.get('/api/check-user-id/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const { id } = req.params;

    // Basic validation
    if (!id || id.length < 3) {
        res.status(400).json({ 
            success: false,
            error: 'ID must be at least 3 characters long',
            available: false
        });
        return;
    }

    try {
        const userResult = await getUserById(id);
        res.json({ 
            success: true,
            available: !userResult.success
        });
    } catch (error) {
        logger.error('Error checking user ID availability:', error);
        res.status(500).json({ 
            success: false,
            error: 'Server error checking ID availability',
            available: false
        });
    }
});

// Add new endpoint to create user
app.post('/api/signup', async (req: Request, res: Response): Promise<void> => {
    const { id, email, verificationToken } = req.body;

    if (!id || !email) {
        res.status(400).json({ 
            success: false,
            error: 'ID and email are required'
        });
        return;
    }

    // If verificationToken is provided, verify it matches the email
    if (verificationToken) {
        try {
            if (!process.env.MAGIC_LINK_SECRET) {
                throw new Error('Magic link secret not configured');
            }
            const decoded = jwt.verify(verificationToken, process.env.MAGIC_LINK_SECRET);
            if (typeof decoded !== 'object' || !decoded.email) {
                throw new Error('Invalid token payload');
            }
            if (decoded.email !== email) {
                res.status(400).json({
                    success: false,
                    error: 'Email does not match verification token'
                });
                return;
            }
        } catch (error) {
            res.status(400).json({
                success: false,
                error: 'Invalid or expired verification token'
            });
            return;
        }
    }

    const result = await createUser(id, email);
    if (!result.success || !result.data) {
        res.status(400).json(result);
        return;
    }

    // If user was created with a valid verification token, generate auth token
    let authToken = null;
    if (verificationToken) {
        authToken = generateAuthToken(result.data);
    }

    logger.info(`Created new user: ${JSON.stringify(result.data)}`);
    res.json({ 
        success: true,
        message: 'User created successfully',
        data: authToken ? { token: authToken, user: result.data } : undefined
    });
});

app.post('/api/createReply', authenticateToken, async (req: Request, res: Response): Promise<void> => {
    try {
        // Destructure required fields from the request body.
        const text: string = req.body.text;
        const parentId: string[] = req.body.parentId;
        const metadata: UnifiedNodeMetadata = req.body.metadata;
        const quote: Quote = req.body.quote;

        // Validate that required fields are provided.
        if (!text || !parentId || !quote || !quote.text || !quote.sourcePostId || !quote.selectionRange) {
            res.status(400).json({ error: 'Missing required fields. Ensure text, parentId, and a full quote (with text, sourcePostId, and selectionRange) are provided.' });
            return;
        }
        if (!metadata || !metadata.authorId) {
            res.status(400).json({ error: 'Missing metadata: authorId is required.' });
            return;
        }

        // Create the new reply object adhering to the unified node structure.
        const newReply = {
            id: crypto.randomUUID(), // Using crypto for unique ID generation
            text,
            parentId, // Expecting an array of parent IDs
            quote,    // Store the complete quote object
            metadata: {
                authorId: metadata.authorId,
                createdAt: new Date().toISOString()
            }
        };

        // Save the new reply in the database under a Redis hash field 'reply'.
        await db.hSet(newReply.id, 'reply', newReply);

        // Use the helper function to convert the quote object into a string key.
        const quoteKey = getQuoteKey(quote);
        const score = Date.now();
        // Use the first parent ID as the primary parent for indexing.
        const actualParentId = Array.isArray(newReply.parentId) ? newReply.parentId[0] : newReply.parentId;
        const replyId = newReply.id;

        // 1. Index for "Replies by Quote (General)"
        await db.zAdd(`replies:quote:${quoteKey}:mostRecent`, score, replyId);

        // 2. Index for "Replies by Parent ID and Detailed Quote"
        await db.zAdd(`replies:uuid:${actualParentId}:quote:${quoteKey}:mostRecent`, score, replyId);

        // Increment the quote count in the hash using the primary parent's ID.
        await db.hIncrBy(`${actualParentId}:quoteCounts`, JSON.stringify(quote), 1);

        // 3. Index for "Replies by Parent ID and Quote Text"
        await db.zAdd(`replies:${actualParentId}:${quote.text}:mostRecent`, score, replyId);

        // 4. Index for "Global Replies Feed" (all replies)
        await db.zAdd('replies:feed:mostRecent', score, replyId);

        // 5. Index for "Conditional Replies by Quote Text Only"
        await db.zAdd(`replies:quote:${quote.text}:mostRecent`, score, replyId);

        logger.info(`Created new reply with ID: ${replyId} for parent: ${actualParentId}`);
        res.json({ 
            success: true,
            data: { id: replyId }
        });
    } catch (err) {
        logger.error('Error creating reply:', err);
        res.status(500).json({ error: 'Server error' });
    }
}) as unknown as RequestHandler;


// Get global replies feed
app.get('/api/getRepliesFeed', async (req: Request, res: Response): Promise<void> => {
    try {
        const { page = 1, limit = 10 } = req.query;

        // Validate and sanitize pagination parameters
        const pageNum = Math.max(1, parseInt(page as string));
        const itemsPerPage = Math.min(100, Math.max(1, parseInt(limit as string)));
        const start = (pageNum - 1) * itemsPerPage;
        const end = start + itemsPerPage - 1;

        // Get total count for pagination info
        const repliesCount = await db.zCard('replies:feed:mostRecent') || 0;
        
        // Get compressed reply keys from the global feed sorted set with pagination
        const compressedReplyKeys = await db.zRange('replies:feed:mostRecent', start, end, { returnCompressed: true }) || [];
        
        // Decompress each reply key
        const replyKeys = await Promise.all(
            compressedReplyKeys.map(key => db.decompress(key))
        );

        // Create the response object
        const response = {
            replies: replyKeys,
            pagination: {
                page: pageNum,
                limit: itemsPerPage,
                repliesCount,
                totalPages: Math.ceil(repliesCount / itemsPerPage)
            }
        };

        // Compress the final response
        const compressedResponse = await db.compress(response);
        
        // Add compression header
        res.setHeader('X-Data-Compressed', 'true');
        res.send(compressedResponse);
    } catch (err) {
        logger.error('Error fetching replies feed:', err);
        res.status(500).json({ error: 'Server error' });
    }
}); 

// Updated GET endpoint with generics for route params and response type.
app.get<{ 
    uuid: string;
    quote: string; 
    sortingCriteria: string 
}, ApiResponse<CursorPaginatedResponse<Reply>>>('/api/getReplies/:uuid/:quote/:sortingCriteria', async (req, res) => {
    try {
        const { uuid, quote, sortingCriteria } = req.params;
        let quoteObj: Quote;
        try {
            // First try parsing as JSON
            const decodedQuote = decodeURIComponent(quote);
            try {
                quoteObj = JSON.parse(decodedQuote);
            } catch (e) {
                // If JSON parsing fails, try pipe-delimited format
                const [text, sourcePostId, range] = decodedQuote.split('|');
                if (!text || !sourcePostId || !range) {
                    throw new Error('Invalid quote format');
                }
                const [start, end] = range.split('-').map(Number);
                quoteObj = {
                    text,
                    sourcePostId,
                    selectionRange: { start, end }
                };
            }
        } catch (error) {
            const errorResponse: ApiResponse<CursorPaginatedResponse<Reply>> = {
                success: false,
                error: 'Invalid quote object provided in URL parameter'
            };
            res.status(400).json(errorResponse);
            return;
        }

        // Validate that the quote object includes the required fields.
        if (!quoteObj.text || !quoteObj.sourcePostId || !quoteObj.selectionRange) {
            const errorResponse: ApiResponse<CursorPaginatedResponse<Reply>> = {
                success: false,
                error: 'Quote object must include text, sourcePostId, and selectionRange fields'
            };
            res.status(400).json(errorResponse);
            return;
        }

        // Generate a unique key for the quote using its properties.
        const quoteKey = getQuoteKey(quoteObj);

        // Cursor-based pagination handling via query parameters.
        const limit = parseInt(req.query.limit as string) || 10;
        // If no cursor is provided, use a high value to start from the newest score.
        const cursor = req.query.cursor ? Number(req.query.cursor) : Number.POSITIVE_INFINITY;
        
        // Build the sorted set key for replies based on the full quote object and sorting criteria.
        const sortedSetKey = `replies:uuid:${uuid}:quote:${quoteKey}:${sortingCriteria}`;
        
        // Step 1: Get reply IDs from the sorted set
        const replyIds = await db.zRevRangeByScore<string>(
            sortedSetKey, 
            cursor, 
            Number.NEGATIVE_INFINITY, 
            { limit }
        );

        const matchingRepliesCount = await db.zCard(sortedSetKey);
        
        let nextCursor: number | null = null;
        if (replyIds && replyIds.length === limit) {
            // Use the score from the last item as the next cursor
            nextCursor = replyIds[replyIds.length - 1].score;
        }

        // Step 2: Fetch the actual reply data for each ID
        const replies = await Promise.all(
            replyIds.map(async (item) => {
                try {
                    // Fetch the actual reply data using the ID
                    const reply = await db.hGet(item.value, 'reply');
                    return reply;
                } catch (err) {
                    logger.error(`Error fetching reply ${item.value}:`, err);
                    return null;
                }
            })
        );

        // Filter out any null values from failed fetches
        const validReplies = replies.filter(reply => reply !== null) as Reply[];
        
        // Prepare the response object with cursor pagination info
        const response = {
            replies: validReplies,
            pagination: {
                limit,
                nextCursor,
                hasMore: nextCursor !== null,
                matchingRepliesCount: matchingRepliesCount || 0
            }
        };

        // Compress and send the response
        const compressedResponse = await db.compress(response) as CursorPaginatedResponse<Reply>;
        res.setHeader('X-Data-Compressed', 'true');
        const apiResponse: ApiResponse<CursorPaginatedResponse<Reply>> = {
            success: true,
            compressedData: compressedResponse
        };
        res.send(apiResponse);
    } catch (err) {
        logger.error('Error fetching replies by quote:', err);
        const errorResponse: ApiResponse<CursorPaginatedResponse<Reply>> = {
            success: false,
            error: 'Server error'
        };
        res.status(500).json(errorResponse);
    }
});

// Get existing selectable quotes for a given node
app.get<{ uuid: string }, ApiResponse<ExistingSelectableQuotes>>('/api/getExistingSelectableQuotes/:uuid', async (req, res) => {
    const { uuid } = req.params;
    const existingSelectableQuotesAndCounts = await db.hGetAll(`${uuid}:`, { returnCompressed: true }) as ExistingSelectableQuotes;
    const apiResponse: ApiResponse<ExistingSelectableQuotes> = {
        success: true,
        compressedData: existingSelectableQuotesAndCounts
    };
    res.json(apiResponse);
});

/**
 * @route   GET /api/combinedNode/:uuid
 * @desc    Retrieves a combined node (story or reply) with unified node structure
 * @access  Public
 */
app.get<{ uuid: string }, ApiResponse<UnifiedNode>>('/api/combinedNode/:uuid', async (req, res) => {
    const { uuid } = req.params;
    if (!uuid) {
        res.status(400).json({ success: false, error: 'UUID is required' });
        return;
    }
    try {
        // Try fetching as a story node first
        let compressedData = await db.hGet(uuid, 'storyTree', { returnCompressed: true });
        let nodeType: 'story' | 'reply' = 'story';
        if (!compressedData) {
            // If not found, try fetching as a reply
            compressedData = await db.hGet(uuid, 'reply', { returnCompressed: true });
            nodeType = 'reply';
        }
        if (!compressedData) {
            res.status(404).json({ success: false, error: 'Node not found' });
            return;
        }
        const rawData = await db.decompress(compressedData);

        let unifiedNode: UnifiedNode;
        if (nodeType === 'story') {
            unifiedNode = {
                id: rawData.id,
                type: 'story',
                content: rawData.text,
                metadata: {
                    parentId: rawData.parentId, // expected to be null for story nodes
                    authorId: rawData.metadata.authorId || 'Unknown',
                    createdAt: rawData.metadata.createdAt,
                    quote: rawData.metadata.quote || undefined
                }
            };
        } else {
            unifiedNode = {
                id: rawData.id,
                type: 'reply',
                content: rawData.text,
                metadata: {
                    parentId: rawData.parentId, // expected to be an array for reply nodes
                    authorId: rawData.metadata.authorId || 'Unknown',
                    createdAt: rawData.metadata.createdAt,
                    quote: rawData.quote || undefined
                }
            };
        }

        const apiResponse: ApiResponse<UnifiedNode> = {
            success: true,
            compressedData: unifiedNode
        };
        const compressedResponse = await db.compress(apiResponse);
        res.setHeader('X-Data-Compressed', 'true');
        res.send(compressedResponse);
    } catch (error) {
        logger.error('Error in combinedNode endpoint:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Existing routes...
app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
    logger.info(`Build hash: ${BUILD_HASH}`);
});
