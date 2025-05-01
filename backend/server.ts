/* requirements
- getUserById checks id with tolowercase
- Accepts development token in non-production environments
- Handles quote metadata in story creation and retrieval
- Stores quote data with source post ID and selection range
- Creates posts (postTrees) with new schema structure separating posts from replies
- Handles reply creation with quote references and parent tracking
- Creates formatted story trees with metadata and node structure
- Manages feed items for root-level posts only
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
- Provides API endpoint to retrieve quote reply counts for a given parent ID, returning CompressedApiResponse<ExistingSelectableQuotes>

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
    DatabaseClient as DatabaseClientBase, 
    User, 
    ExistingUser,
    UserResult, 
    Reply, 
    FeedItem,
    AuthenticatedRequest,
    CompressedApiResponse,
    CursorPaginatedResponse,
    TokenPayload,
    AuthTokenPayload,
    Quote,
    Replies,
    ExistingSelectableQuotes,
    CreateReplyResponse,
    RedisSortedSetItem,
    FeedItemsResponse,
    RepliesFeedResponse,
    SortingCriteria,
    Post,
    PostCreationRequest,
    Compressed
} from './types/index.js';
import { getQuoteKey } from './utils/quoteUtils.js';
import { createCursor, decodeCursor } from './utils/cursorUtils.js';
import { uuidv7obj } from 'uuidv7';
import { Uuid25 } from 'uuid25';

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

// Extend the DatabaseClient type to include lLen and hIncrementQuoteCount
type DatabaseClient = DatabaseClientBase & {
    lLen(key: string): Promise<number>;
    hIncrementQuoteCount(key: string, field: string, quoteValue: any): Promise<number>;
};

// Cast the result to the extended type
const db: DatabaseClient = createDatabaseClient() as DatabaseClient;

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
        // Cast db to the base interface for seeding
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
app.get('/api/feed', async (req: Request, res: Response<CompressedApiResponse<Compressed<FeedItemsResponse>>>): Promise<void> => {
    const limit = parseInt(req.query.limit as string) || 10;
    let cursor = 0;

    // Parse cursor if provided
    if (req.query.cursor) {
        try {
            const decodedCursor = decodeCursor(req.query.cursor as string);
            cursor = parseInt(decodedCursor.id);
        } catch (error) {
            res.status(400).json({success: false, error: 'Invalid cursor format' });
            return;
        }
    }

    logger.info("Handling request for feed with cursor", cursor, "and limit", limit);
    
    try {
        logger.info('Current db connection state: %O', {
            connected: db.isConnected?.() || 'unknown',
            ready: db.isReady?.() || 'unknown'
        });

        // Get total length for pagination
        const totalItems = await db.lLen('feedItems');
        
        // Validate cursor bounds
        if (cursor < 0) {
            res.status(400).json({success: false, error: 'Cursor cannot be negative' });
            return;
        }
        if (cursor > totalItems) {
            res.status(400).json({success: false, error: 'Cursor is beyond the end of the feed' });
            return;
        }

        const endIndex = Math.min(cursor + limit, totalItems);

        logger.info('Attempting to fetch feed items from db with range: %O', {
            cursor,
            endIndex,
            key: 'feedItems'
        });

        // Define a type guard function for FeedItem
        function isValidFeedItem(item: any): item is FeedItem {
            return (
                typeof item === 'object' &&
                typeof item.id === 'string' &&
                typeof item.text === 'string' &&
                typeof item.authorId === 'string' &&
                typeof item.createdAt === 'string'
                // Add more checks as per your FeedItem structure
            );
        }

        // Fetch potentially stringified items from Redis
        const fetchedRawItems: unknown = await db.lRange('feedItems', cursor, endIndex - 1, { returnCompressed: false });

        // Ensure fetchedItems is an array
        if (!Array.isArray(fetchedRawItems)) {
            throw new Error("Database did not return an array for feed items");
        }

        // Parse each item and validate
        const parsedItems: FeedItem[] = [];
        for (const rawItem of fetchedRawItems) {
            if (typeof rawItem !== 'string') {
                logger.warn('Found non-string item in feedItems list:', rawItem);
                continue; // Skip non-string items if any exist
            }
            try {
                const item = JSON.parse(rawItem);
                if (isValidFeedItem(item)) {
                    parsedItems.push(item);
                } else {
                    logger.warn('Found invalid FeedItem structure after parsing:', item);
                    // Optionally, handle invalid items (e.g., skip, log, move to DLQ)
                }
            } catch (parseError) {
                logger.error('Failed to parse feed item JSON:', rawItem, parseError);
                // Optionally, handle parse errors
            }
        }
        
        // Assign the successfully parsed and validated items
        const feedItems: FeedItem[] = parsedItems;

        logger.info("Parsed feed items: %O", feedItems);
        
        // Create the response object with cursor-based pagination
        const data = {
            data: feedItems,
            pagination: {
                nextCursor: endIndex < totalItems ? createCursor(endIndex.toString(), Date.now(), 'story') : undefined,
                prevCursor: cursor > 0 ? createCursor(Math.max(0, cursor - limit).toString(), Date.now(), 'story') : undefined,
                hasMore: endIndex < totalItems,
                totalCount: totalItems
            }
        } as FeedItemsResponse;
        
        // Compress the final response
        const compressedData = await db.compress(data);
        const response = {
            success: true,
            compressedData: compressedData
        } as CompressedApiResponse<Compressed<FeedItemsResponse>>;

        // Add compression header to indicate data is compressed
        res.setHeader('X-Data-Compressed', 'true');
        res.send(response);
    } catch (error) {
        if (error instanceof Error) {
            logger.error('Error fetching feed items:', error);
            res.status(500).json({success: false, error: 'Internal server error' });
        }
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

// --- Environment Variable Checks ---
const requiredEnvVars: string[] = [];
if (process.env.NODE_ENV === 'production') {
    requiredEnvVars.push(
        'FIREBASE_CREDENTIAL', 
        'FIREBASE_DATABASE_URL', 
        'MAGIC_LINK_SECRET', 
        'AUTH_TOKEN_SECRET',
        'EMAIL_HOST',
        'EMAIL_PORT',
        'EMAIL_USERNAME',
        'EMAIL_PASSWORD'
    );
}

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error(`FATAL ERROR: Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1); // Exit immediately
}
// --- End Environment Variable Checks ---

// Helper Functions
/**
 * Generates a short-lived JWT for magic link authentication.
 * @param email The user's email address.
 * @returns The generated JWT.
 * @throws {Error} If MAGIC_LINK_SECRET is not configured (should be caught at startup).
 */
const generateMagicToken = (email: string): string => {
    // Startup Check: MAGIC_LINK_SECRET presence is checked at application startup.
    return jwt.sign(
        { email } as TokenPayload,
        process.env.MAGIC_LINK_SECRET as string, // Added 'as string' for type safety after check
        { expiresIn: '15m' } // Magic link valid for 15 minutes
    );
};

/**
 * Generates a longer-lived JWT for user authentication after successful login.
 * @param user The user object containing id and email.
 * @returns The generated JWT.
 * @throws {Error} If AUTH_TOKEN_SECRET is not configured (should be caught at startup).
 */
const generateAuthToken = (user: User): string => {
    // Startup Check: AUTH_TOKEN_SECRET presence is checked at application startup.
    return jwt.sign(
        { id: user.id, email: user.email } as AuthTokenPayload,
        process.env.AUTH_TOKEN_SECRET as string, // Added 'as string' for type safety after check
        { expiresIn: '7d' } // Auth token valid for 7 days
    );
};

// Apply to magic link route
const magicLinkLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 5 requests per windowMs
    message: 'Too many magic link requests from this IP, please try again later.',
});

// Helper function to generate compressed 25-digit UUID v7
const generateCondensedUuid = (): string => {
  const uuidObj = uuidv7obj();
  const uuid25Instance = Uuid25.fromBytes(uuidObj.bytes);
  return uuid25Instance.value;
};

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
        // Startup Check: MAGIC_LINK_SECRET presence is checked at application startup.
        const decoded = jwt.verify(token, process.env.MAGIC_LINK_SECRET as string);
        logger.info('Successfully decoded token:', decoded);
        if (typeof decoded !== 'object' || !decoded.email) {
            throw new Error('Invalid token payload');
        }

        logger.info('Looking up user by email:', decoded.email);
        const userResult = await getUserByEmail(decoded.email);
        logger.info('User lookup result:', userResult);

        if (!userResult.success) {
            logger.warn('User not found for email:', decoded.email);
            res.status(401).json({ 
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
        // Startup Check: AUTH_TOKEN_SECRET presence is checked at application startup.
        const decoded = jwt.verify(token, process.env.AUTH_TOKEN_SECRET as string) as AuthTokenPayload;
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

app.post('/api/createPostTree', authenticateToken, ((async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { postTree } = req.body as { postTree: PostCreationRequest };
        if (!postTree || !postTree.content) {
            res.status(400).json({ error: 'PostTree data with content is required' });
            return;
        }

        // Trim the content
        const trimmedContent = postTree.content.trim();

        // Validate content length using trimmed content
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

        // Generate a new UUID for the story tree
        const uuid = generateCondensedUuid();
        
        // Create the full object using trimmed content
        const formattedPostTree = {
            id: uuid,
            content: trimmedContent,
            parentId: null, // Root-level posts always have null parentId
            authorId: req.user.id,
            createdAt: new Date().toISOString(),
        } as Post;

        // Store in Redis
        await db.hSet(uuid, 'postTree', JSON.stringify(formattedPostTree));
        await db.lPush('allPostTreeIds', uuid);

        // Add post ID to user's set of posts
        await db.sAdd(`user:${req.user.id}:posts`, uuid);

        // Add to feed items (only root-level posts go to feed)
        const feedItem = {
            id: uuid,
            text: trimmedContent,
            authorId: req.user.id,
            createdAt: formattedPostTree.createdAt
        } as FeedItem;
        await db.lPush('feedItems', JSON.stringify(feedItem));
        logger.info(`Added feed item for story ${JSON.stringify(feedItem)}`);

        logger.info(`Created new PostTree with UUID: ${uuid}`);
        res.json({ id: uuid });
    } catch (err) {
        logger.error('Error creating PostTree:', err);
        res.status(500).json({ error: 'Server error' });
    }
}) as unknown as RequestHandler));

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
            // Startup Check: MAGIC_LINK_SECRET presence is checked at application startup.
            const decoded = jwt.verify(verificationToken, process.env.MAGIC_LINK_SECRET as string);
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

app.post('/api/createReply', authenticateToken, async (req: Request, res: Response<CreateReplyResponse>): Promise<void> => {
    try {
        // Destructure required fields from the request body.
        const text: string = req.body.text;
        const parentId: string[] = req.body.parentId;
        const quote: Quote = req.body.quote;
        const user: User = (req as AuthenticatedRequest).user;

        // Validate that required fields are provided (before trimming text).
        if (!text || !parentId || !quote || !quote.text || !quote.sourceId || !quote.selectionRange) {
            res.status(400).json({ 
                success: false, 
                error: 'Missing required fields. Ensure text, parentId, and a full quote (with text, sourceId, and selectionRange) are provided.' 
            });
            return;
        }

        // Trim the reply text
        const trimmedText = text.trim();

        // Validate reply text length using trimmed text
        const MAX_REPLY_LENGTH = 1000;
        const MIN_REPLY_LENGTH = 50;
        const IGNORE_MIN_REPLY_LENGTH = ["Yes!"]
        if (trimmedText.length > MAX_REPLY_LENGTH) {
            res.status(400).json({
                success: false,
                error: `Reply text exceeds the maximum length of ${MAX_REPLY_LENGTH} characters.`
            });
            return;
        }
        if (!IGNORE_MIN_REPLY_LENGTH.includes(trimmedText) && trimmedText.length < MIN_REPLY_LENGTH) {
            res.status(400).json({
                success: false,
                error: `Reply text must be at least ${MIN_REPLY_LENGTH} characters long.`
            });
            return;
        }

        // Create the new reply object using trimmed text
        const newReply = {
            id: generateCondensedUuid(),
            text: trimmedText, // Use trimmed text
            parentId, // Expecting an array of parent IDs
            quote,    // Store the complete quote object
            authorId: user.id,
            createdAt: new Date().getTime().toString() // don't use metadata.createdAt so that users can't change the createdAt time of a reply
        } as Reply;

        // Save the new reply in the database under a Redis hash field 'reply'.
        await db.hSet(newReply.id, 'reply', newReply);

        // Use the helper function to convert the quote object into a string key.
        const quoteKey = getQuoteKey(quote);
        const score = Date.now();
        // Use the first parent ID as the primary parent for indexing.
        const actualParentId = Array.isArray(newReply.parentId) ? newReply.parentId[0] : newReply.parentId;
        const replyId = newReply.id;

        // 1. Index for "Replies by Quote (General - using quoteKey)"
        await db.zAdd(`replies:quote:${quoteKey}:mostRecent`, score, replyId);

        // 2. Index for "Replies by Parent ID and Detailed Quote (using quoteKey)"
        await db.zAdd(`replies:uuid:${actualParentId}:quote:${quoteKey}:mostRecent`, score, replyId);

        // 3. Increment quote count using the new transactional method
        await db.hIncrementQuoteCount(`${actualParentId}:quoteCounts`, quoteKey, quote);

        // Add reply ID to user's set of replies
        await db.sAdd(`user:${user.id}:replies`, replyId);

        // --- Reinstate removed indices ---
        // 4. Index for "Replies by Parent ID and Sanitized Quote Text"
        await db.zAdd(`replies:${actualParentId}:${quote.text}:mostRecent`, score, replyId);

        // 5. Index for "Global Replies Feed"
        await db.zAdd('replies:feed:mostRecent', score, replyId);

        // 6. Index for "Conditional Replies by Sanitized Quote Text Only"
        await db.zAdd(`replies:quote:${quote.text}:mostRecent`, score, replyId);
        // --- End reinstated indices ---
        
        logger.info(`Created new reply with ID: ${replyId} for parent: ${actualParentId}`);

        // Create a response object
        const response = {
            success: true,
            data: { id: replyId }
        } as CompressedApiResponse<{ id: string }>;
        res.send(response);
    } catch (err) {
        logger.error('Error creating reply:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
}) as RequestHandler<any, any, { text: string, parentId: string[], quote: Quote }>;



// Get global replies feed
app.get('/api/getRepliesFeed', async (req: Request, res: Response<CompressedApiResponse<Compressed<RepliesFeedResponse>>>): Promise<void> => {
    try {

        // Cursor-based pagination handling via query parameters.
        const limit = parseInt(req.query.limit as string) || 10;
        // If no cursor is provided, use a high value to start from the newest score.
        const cursor = req.query.cursor as string;

        // Get total count for pagination info
        const repliesCount = await db.zCard('replies:feed:mostRecent') || 0;
        
        // Get compressed reply keys from the global feed sorted set with pagination
        const scanResult = await db.zscan('replies:feed:mostRecent', cursor, { count: limit });

        const replies = scanResult.items.map((item: RedisSortedSetItem<string>) => {
            return JSON.parse(item.value) as Reply;
        });

        // Create the response object
        const data = {
            data: replies,
            pagination: {
                nextCursor: scanResult.cursor,
                prevCursor: cursor,
                hasMore: scanResult.cursor !== '0',
                totalCount: repliesCount
            }
        } as RepliesFeedResponse;


        // Compress the final response
        const compressedData = await db.compress(data);
        const response = {
            success: true,
            compressedData: compressedData
        } as CompressedApiResponse<Compressed<RepliesFeedResponse>>;
        
        // Add compression header
        res.setHeader('X-Data-Compressed', 'true');
        res.send(response);
    } catch (err) {
        logger.error('Error fetching replies feed:', err);
        res.status(500).json({success: false, error: 'Server error' });
    }
}); 

// Updated GET endpoint with generics for route params and response type.
/**
 * @route   GET /api/getReplies/:uuid/:quote/:sortingCriteria
 * @desc    Retrieves replies associated with a specific quote on a parent node.
 * @access  Public
 * @param   {string} uuid - The ID of the parent node.
 * @param   {string} quote - URL-encoded JSON string of the Quote object.
 * @param   {SortingCriteria} sortingCriteria - Sorting order (e.g., 'mostRecent').
 * @query   {number} [limit=10] - Max number of replies per page.
 * @query   {string} [cursor] - Pagination cursor.
 * @returns {CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>>} Compressed response with replies and pagination.
 * @throws {Error} If the decoded quote parameter is invalid JSON.
 *                 (Handled: Caught locally, returns 400 response).
 */
app.get<{ 
    uuid: string;
    quote: string; 
    sortingCriteria: SortingCriteria 
}, CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>>>('/api/getReplies/:uuid/:quote/:sortingCriteria', async (req, res) => {
    try {
        const { uuid, quote, sortingCriteria } = req.params;
        let quoteObj: Quote;
        try {
            const decodedQuote = decodeURIComponent(quote);
            try {
                quoteObj = JSON.parse(decodedQuote);
            } catch (e) {
                logger.error('Error parsing quote: [', decodedQuote, "] with error: [", e, "]");
                throw new Error('Invalid quote format');
            }
        } catch (error) {
            const errorResponse: CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>> = {
                success: false,
                error: 'Invalid quote object provided in URL parameter'
            };
            res.status(400).json(errorResponse);
            return;
        }

        // Validate that the quote object includes the required fields.
        if (!quoteObj.text || !quoteObj.sourceId || !quoteObj.selectionRange) {
            const errorResponse: CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>> = {
                success: false,
                error: 'Quote object must include text, sourceId, and selectionRange fields'
            };
            res.status(400).json(errorResponse);
            return;
        }

        // Generate a unique key for the quote using its properties.
        const quoteKey = getQuoteKey(quoteObj);
        logger.info('[getReplies] Decoded quote:', quoteObj);
        logger.info('[getReplies] Constructed Redis key:', `replies:uuid:${uuid}:quote:${quoteKey}:${sortingCriteria}`);
        
        // Cursor-based pagination handling via query parameters.
        const limit = parseInt(req.query.limit as string) || 10;
        // If no cursor is provided, use a high value to start from the newest score.
        const cursor = req.query.cursor as string;
        
        // Build the sorted set key for replies based on the full quote object and sorting criteria.
        const sortedSetKey = `replies:uuid:${uuid}:quote:${quoteKey}:${sortingCriteria}`;
        
        // Step 1: Get reply IDs from the sorted set using ZSCAN
        const scanCursor = cursor || '0';
        const scanResult = await db.zscan(sortedSetKey, scanCursor, { count: limit });
        logger.info('[getReplies] Number of reply IDs found:', scanResult.items.length);
        
        const matchingRepliesCount = await db.zCard(sortedSetKey);
        
        let nextCursor: string | null = null;
        if (scanResult.cursor !== null) {
            // If there are more items to scan, set the next cursor
            nextCursor = scanResult.cursor;
        }
        logger.info('[getReplies] scanResult:', scanResult);
        // Step 2: Fetch the actual reply data for each ID
        const replies = await Promise.all(
            scanResult.items.map(async (item: RedisSortedSetItem<string>) => {
                try {
                    // Fetch the potentially stringified reply data using the ID
                    const replyData = await db.hGet(item.value, 'reply');
                    logger.info(`[getReplies] Raw reply data for ID ${item.value}:`, replyData);
                    
                    // Parse the data if it's a string
                    if (typeof replyData === 'string') {
                        const parsedReply = JSON.parse(replyData) as Reply;
                        // Optional: Add validation to ensure it matches Reply structure
                        return parsedReply;
                    } else if (typeof replyData === 'object' && replyData !== null) {
                        // If hGet somehow returned the object directly (less likely now)
                        // Optional: Add validation here too
                        return replyData as Reply;
                    } else {
                         logger.warn(`[getReplies] Unexpected data type or null received for reply ${item.value}:`, replyData);
                         return null;
                    }
                } catch (err) {
                    logger.error(`Error fetching or parsing reply ${item.value}:`, err);
                    return null;
                }
            })
        );

        logger.info('[getReplies] All fetched replies:', replies);
        // Filter out any null values from failed fetches
        const validReplies = replies.filter((reply: Reply | null): reply is Reply => reply !== null);
        
        // Prepare the response object with cursor pagination info
        const response = {
            data: validReplies,
            pagination: {
                limit,
                nextCursor,
                hasMore: nextCursor !== null,
                totalCount: matchingRepliesCount || 0
            }
        };

        // Compress and send the response
        const compressedResponse = await db.compress(response) as Compressed<CursorPaginatedResponse<Reply>>;
        res.setHeader('X-Data-Compressed', 'true');
        const CompressedApiResponse: CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>> = {
            success: true,
            compressedData: compressedResponse
        };
        res.send(CompressedApiResponse);
    } catch (err) {
        logger.error('Error fetching replies by quote:', err);
        const errorResponse: CompressedApiResponse<Compressed<CursorPaginatedResponse<Reply>>> = {
            success: false,
            error: 'Server error'
        };
        res.status(500).json(errorResponse);
    }
});

/**
 * @route   GET /api/getPost/:uuid
 * @desc    Retrieves a post, a top level postTree element
 * @access  Public
 */
app.get<{ uuid: string }, CompressedApiResponse<Compressed<Post>>>('/api/getPost/:uuid', async (req, res) => {
    const { uuid } = req.params;
    if (!uuid) {
        res.status(400).json({ success: false, error: 'UUID is required' });
        return; 
    }
    try {
        // Fetch using the correct field key 'postTree'
        let maybePostString = await db.hGet(uuid, 'postTree', { returnCompressed: false });
        if (!maybePostString || typeof maybePostString !== 'string') {
            // If not found or not a string, return 404
            res.status(404).json({ success: false, error: 'Node not found or invalid format' });
            return;
        }

        // Parse the string into an object
        let maybePost: any;
        try {
            maybePost = JSON.parse(maybePostString);
        } catch (parseError) {
            logger.error('Failed to parse post JSON:', maybePostString, parseError);
            res.status(500).json({ success: false, error: 'Failed to parse post data' });
            return;
        }

        // Define a type guard function
        function isValidPost(item: any): item is Post {
            return (
                typeof item === 'object' &&
                typeof item.id === 'string' &&
                typeof item.content === 'string' &&
                typeof item.authorId === 'string' &&
                typeof item.createdAt === 'string'
            );
        }

        // Validate post structure
        if (!isValidPost(maybePost)) {
            logger.error('Invalid post structure returned from database:', maybePost);
            res.status(500).json({ success: false, error: 'Invalid post data' });
            return;
        }
        const post = await db.compress(maybePost) as Compressed<Post>;
    
        const CompressedApiResponse: CompressedApiResponse<Compressed<Post>> = {
            success: true,
            compressedData: post
        };
        res.setHeader('X-Data-Compressed', 'true');
        res.send(CompressedApiResponse);
    } catch (error) {
        logger.error('Error in getPost endpoint:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// New API endpoint: Retrieves quote reply counts for a given parent ID.
// Returns an CompressedApiResponse containing ExistingSelectableQuotes, where the quoteCounts property is an array of map entries.
app.get<{ parentId: string }, CompressedApiResponse<Compressed<ExistingSelectableQuotes>>>('/api/getQuoteCounts/:parentId', async (req: Request, res: Response) => {
    const { parentId } = req.params;
    if (!parentId) {
        res.status(400).json({ success: false, error: 'Parent ID is required' });
        return;
    }
    try {
        // Retrieve the quote reply counts from Firebase using the key pattern: "<parentId>:quoteCounts"
        const rawQuoteData = await db.hGetAll(`${parentId}:quoteCounts`);

        if (!rawQuoteData) {
          // Handle case where no counts exist for this parent
          const compressedResponse = await db.compress({ quoteCounts: [] });
          const apiResponse: CompressedApiResponse<Compressed<ExistingSelectableQuotes>> = {
              success: true,
              compressedData: compressedResponse
          };
          res.setHeader('X-Data-Compressed', 'true');
          res.send(apiResponse);
          return;
        }

        // Process the raw results into a Map<Quote, number>
        const quoteCountsMap = new Map<Quote, number>();
        for (const [_key, valueObj] of Object.entries(rawQuoteData)) {
            // The valueObj should be { quote: QuoteObject, count: number }
            if (valueObj && typeof valueObj === 'object' && valueObj.quote && typeof valueObj.count === 'number') {
                // Ensure the quote structure is valid before adding
                // You might want more robust validation based on the Quote type definition
                if (valueObj.quote.text && valueObj.quote.sourceId && valueObj.quote.selectionRange) {
                    quoteCountsMap.set(valueObj.quote as Quote, valueObj.count);
                } else {
                    logger.warn(`Invalid quote structure found in quoteCounts for parent ${parentId}:`, valueObj.quote);
                }
            } else {
                logger.warn(`Invalid data structure found in quoteCounts for parent ${parentId}:`, valueObj);
            }
        }
        
        // Convert the Map into an array of entries.
        // This is equivalent to: JSON.stringify(Array.from(quoteCountsMap.entries()))
        // since res.json will automatically serialize the object.
        const quoteCountsArray = Array.from(quoteCountsMap.entries());
        const compressedResponse = await db.compress({ quoteCounts: quoteCountsArray });

        const CompressedApiResponse: CompressedApiResponse<Compressed<ExistingSelectableQuotes>> = {
            success: true,
            compressedData: compressedResponse
        };
        res.setHeader('X-Data-Compressed', 'true');
        res.send(CompressedApiResponse);
    } catch (error) {
        logger.error('Error retrieving quote counts for parent ID %s: %s', parentId, error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Existing routes...
app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
    logger.info(`Build hash: ${BUILD_HASH}`);
});
