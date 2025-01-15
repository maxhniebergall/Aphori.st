/* requirements
- getUserById checks id with tolowercase
- Accepts development token in non-production environments
*/

import express, { json } from "express";
import { createDatabaseClient } from './db/index.js';
import newLogger from './logger.js';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { sendEmail } from './mailer.js';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { seedDefaultStories } from './prodSeed.js';
import { seedDevStories } from './seed.js';
import fs from 'fs';

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
app.use(json());

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
app.use((req, res, next) => {
  res.setHeader('X-Build-Hash', BUILD_HASH);
  next();
});

// Database readiness check
app.use((req, res, next) => {
    if (!isDbReady) {
        logger.warn('Database not ready, returning 503');
        return res.status(503).json({ 
            error: 'Service initializing, please try again in a moment'
        });
    }
    next();
});

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const db = createDatabaseClient();

let isDbReady = false;

await db.connect().then(() => {
    logger.info('Database client connected');
    isDbReady = true;
    // Only seed development stories in non-production environments
    if (process.env.NODE_ENV !== 'production') {
        // logger.info('Development environment detected, seeding dev stories...');
        logger.info('Development environment detected, seeding default stories...');
        seedDevStories(db);
    } else {
        logger.info('Production environment detected, skipping dev seed');
    }
}).catch(err => {
    logger.error('Database connection failed: %O', err);
    process.exit(1);
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token required.' });
    }

    // In development, accept the dev token
    if (process.env.NODE_ENV !== 'production' && token === 'dev_token') {
        req.user = {
            id: 'dev_user',
            email: 'dev@aphori.st'
        };
        return next();
    }

    jwt.verify(token, process.env.AUTH_TOKEN_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token.' });
        }
        req.user = user;
        next();
    });
};

app.post("/api/createStatement", authenticateToken, async (req, res) => {
    if (req.body.uuid && req.body.value) {
        try {
            const setResult = await db.set(req.body.uuid, req.body.value);
            logger.info('Set Result: %s', setResult);
            res.send();
        } catch (e) {
            logger.error('Error setting value: %O', e);
            res.status(500).json(e);
        }
    } else {
        res.status(400).json({ error: 'Wrong input.' });
    }
});

app.get('/api/getStatement/:key', async (req, res) => {
    if (!req.params.key) {
        return res.status(400).json({ error: 'Wrong input.' });
    }

    try {
        const value = await db.get(req.params.key);
        logger.info('Fetched value for key "%s": %s', req.params.key, value);
        res.json({ value: value });
    } catch (e) {
        logger.error('Error getting value: %O', e);
        res.status(500).json(e);
    }
});

app.post("/api/setvalue", authenticateToken, async (req, res) => {
    if (req.body.key && req.body.value) {
        try {
            const setResult = await db.set(req.body.key, req.body.value);
            logger.info('Set Result: %s', setResult);
            res.send();
        } catch (e) {
            logger.error('Error setting value: %O', e);
            res.status(500).json(e);
        }
    } else {
        res.status(400).json({ error: 'Wrong input.' });
    }
});

app.get('/api/getValue/:key', async (req, res) => {
    if (!req.params.key) {
        return res.status(400).json({ error: 'Wrong input.' });
    }

    try {
        const value = await db.get(req.params.key);
        logger.info('Fetched value for key "%s": %s', req.params.key, value);
        res.json({ value: value });
    } catch (e) {
        logger.error('Error getting value: %O', e);
        res.status(500).json(e);
    }
});

// Get story data by UUID
app.get('/api/storyTree/:uuid', async (req, res) => {
    const uuid = req.params.uuid;

    if (!uuid) {
        return res.status(400).json({ error: 'UUID is required' });
    }

    try {
        logger.info(`Fetching storyTree with UUID: [${uuid}]`);
        const data = await db.hGet(uuid, 'storyTree', { returnCompressed: true });
        logger.info(`Raw data from Redis: [${data}]`);

        if (!data) {
            logger.warn(`StoryTree with UUID ${uuid} not found`);
            return res.status(404).json({ error: 'StoryTree not found' });
        }

        // Add compression header to indicate data is compressed
        res.setHeader('X-Data-Compressed', 'true');
        res.send(data);
    } catch (err) {
        logger.info('Error fetching data from Redis:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});

  // Get feed data with pagination
app.get('/api/feed', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = 10; // Number of items per page
    logger.info("Handling request for feed at page "+page)
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

      let results = await db.lRange('feedItems', startIndex, endIndex, { returnCompressed: true }); 
      logger.info('Raw db response for feed items: %O', results);

        if (results.err) {
          logger.error('db error when fetching feed: %O', results.err);
          return res.status(500).json({ error: 'Error fetching data from Redis' });
        }

        // Add compression header to indicate data is compressed
        res.setHeader('X-Data-Compressed', 'true');
        res.json({
          page,
          items: results,
        });
    } catch (error) {
      logger.error('Error fetching feed items: %O', {
          error,
          stack: error.stack,
          message: error.message
      });
      res.status(500).json({ error: 'Server error' });
    }
});

// Constants for user-related keys
const USER_PREFIX = 'user';
const USER_IDS_SET = 'user_ids';
const EMAIL_TO_ID_PREFIX = 'email_to_id';

const getUserById = async (id) => {
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

const getUserByEmail = async (email) => {
    // Get user ID from email mapping
    const userId = await db.get(db.encodeKey(email.toLowerCase(), EMAIL_TO_ID_PREFIX));
    if (!userId) {
        return {
            success: false,
            error: 'User not found'
        };
    }

    const userResult = await getUserById(userId);
    if (!userResult.success) {
        return userResult;
    }

    return {
        success: true,
        data: {
            ...userResult.data,
            id: userId
        }
    };
};

const createUser = async (id, email) => {
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

    const userData = {
        email,
        createdAt: new Date().toISOString()
    };

    try {
        // Store user data
        await db.hSet(db.encodeKey(id, USER_PREFIX), 'data', userData);
        // Add ID to set of user IDs
        await db.sAdd(USER_IDS_SET, id);
        // Create email to ID mapping
        await db.set(db.encodeKey(email, EMAIL_TO_ID_PREFIX), id);

        return {
            success: true,
            data: { id, ...userData }
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
const generateMagicToken = (email) => {
    return jwt.sign(
        { email },
        process.env.MAGIC_LINK_SECRET,
        { expiresIn: '15m' } // Magic link valid for 15 minutes
    );
};

const generateAuthToken = (user) => {
    return jwt.sign(
        { id: user.id, email: user.email },
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
app.post('/api/auth/send-magic-link', magicLinkLimiter, async (req, res) => {
    const { email, isSignupInRequest } = req.body;

    // Validate email
    if (!email) {
        logger.error('Missing email in request body');
        return res.status(400).json({ 
            success: false,
            error: 'Email is required'
        });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        logger.error(`Invalid email format: ${email}`);
        return res.status(400).json({ 
            success: false,
            error: 'Invalid email format'
        });
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
app.post('/api/auth/verify-magic-link', async (req, res) => {
    const { token } = req.body;
    logger.info('Received verify-magic-link request with token:', token);

    if (!token) {
        logger.warn('No token provided in request');
        return res.status(400).json({ 
            success: false,
            error: 'Token is required'
        });
    }

    try {
        logger.info('Attempting to verify JWT token');
        const decoded = jwt.verify(token, process.env.MAGIC_LINK_SECRET);
        logger.info('Successfully decoded token:', decoded);

        logger.info('Looking up user by email:', decoded.email);
        const userResult = await getUserByEmail(decoded.email);
        logger.info('User lookup result:', userResult);

        if (!userResult.success) {
            logger.warn('User not found for email:', decoded.email);
            return res.status(300).json({ 
                success: false,
                error: 'User not found',
                email: decoded.email
            });
        }

        // Generate auth token
        logger.info('Generating auth token for user:', userResult.data);
        const authToken = generateAuthToken({
            id: userResult.data.id,
            email: userResult.data.email
        });

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
        logger.error('Error verifying magic link:', {
            error: error.message,
            name: error.name,
            stack: error.stack,
            token
        });
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
app.post('/api/auth/verify-token', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ 
            success: false,
            error: 'Token is required'
        });
    }

    // In development, accept the dev token
    if (process.env.NODE_ENV !== 'production' && token === 'dev_token') {
        return res.json({ 
            success: true,
            data: {
                id: 'dev_user',
                email: 'dev@example.com'
            }
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.AUTH_TOKEN_SECRET);
        const userResult = await getUserById(decoded.id);

        if (!userResult.success) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid token'
            });
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

app.get('/api/profile', authenticateToken, (req, res) => {
    const user = users.find(u => u.id === req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ id: user.id, email: user.email });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

app.post('/api/createStoryTree', authenticateToken, async (req, res) => {
    try {
        const { storyTree } = req.body;
        if (!storyTree) {
            return res.status(400).json({ error: 'StoryTree data is required' });
        }

        // Generate a new UUID for the story tree
        const uuid = crypto.randomUUID();
        
        // Format nodes array to match frontend expectations
        const nodes = storyTree.nodes || [];

        // Create the full object for storing in Redis
        const formattedStoryTree = {
            id: uuid,
            text: storyTree.content || storyTree.text, // Support both content and text fields
            nodes: nodes,
            parentId: storyTree.parentId || null,
            metadata: {
                title: storyTree.title,
                author: storyTree.author,
                authorId: req.user.id,
                authorEmail: req.user.email,
                createdAt: new Date().toISOString(),
                quote: storyTree.quote ? {
                    text: storyTree.quote.text,
                    sourcePostId: storyTree.quote.sourcePostId,
                    selectionRange: storyTree.quote.selectionRange
                } : null
            },
            totalNodes: nodes.length
        };

        // Store in Redis
        await db.hSet(uuid, 'storyTree', JSON.stringify(formattedStoryTree));
        await db.lPush('allStoryTreeIds', uuid);

        // Add to feed items only if it's a root level story
        if (!storyTree.parentId) {
            const feedItem = {
                id: uuid,
                title: storyTree.title,
                text: storyTree.content || storyTree.text, // Support both content and text fields
                author: {
                    id: req.user.id,
                    email: req.user.email
                },
                createdAt: formattedStoryTree.metadata.createdAt,
                quote: formattedStoryTree.metadata.quote
            };
            await db.lPush('feedItems', JSON.stringify(feedItem));
            logger.info(`Added feed item for story ${JSON.stringify(feedItem)}`);
        }

        logger.info(`Created new StoryTree with UUID: ${uuid}`);
        res.json({ id: uuid });
    } catch (err) {
        logger.error('Error creating StoryTree:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/seed-default-stories', async (req, res) => { 
    try {
        logger.info('Starting to seed default stories...');
        // Only allow seeding dev stories in non-production environments
        if (process.env.NODE_ENV === 'production') {
            logger.info('Production environment detected, seeding production stories...');
            await seedDefaultStories(db);
        } else {
            logger.info('Development environment detected, seeding dev stories...');
            await seedDevStories(db);
        }
        logger.info('Successfully seeded default stories');
        res.status(200).json({ message: 'Successfully seeded default stories' });
    } catch (error) {
        logger.error('Error during seeding:', error);
        res.status(500).json({ 
            error: 'Failed to seed default stories',
            details: error.message
        });
    }
});

/**
 * @route   GET /api/check-user-id/:id
 * @desc    Check if a user ID is available
 * @access  Public
 */
app.get('/api/check-user-id/:id', async (req, res) => {
    const { id } = req.params;

    // Basic validation
    if (!id || id.length < 3) {
        return res.status(400).json({ 
            success: false,
            error: 'ID must be at least 3 characters long',
            available: false
        });
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
app.post('/api/signup', async (req, res) => {
    const { id, email, verificationToken } = req.body;

    if (!id || !email) {
        return res.status(400).json({ 
            success: false,
            error: 'ID and email are required'
        });
    }

    // If verificationToken is provided, verify it matches the email
    if (verificationToken) {
        try {
            const decoded = jwt.verify(verificationToken, process.env.MAGIC_LINK_SECRET);
            if (decoded.email !== email) {
                return res.status(400).json({
                    success: false,
                    error: 'Email does not match verification token'
                });
            }
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired verification token'
            });
        }
    }

    const result = await createUser(id, email);
    if (!result.success) {
        return res.status(400).json(result);
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

// Existing routes...
app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
    logger.info(`Build hash: ${BUILD_HASH}`);
});
