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

app.use(cors({
  origin: function(origin, callback) {    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      logger.debug('Request with no origin');
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      logger.warn(`CORS blocked origin: ${origin}`);
      return callback(new Error(msg), false);
    }
    logger.debug(`CORS allowed origin: ${origin}`);
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Frontend-Hash'],
  credentials: true,
  maxAge: 86400 // Cache preflight requests for 24 hours
}));

// Add build hash to all responses
app.use((req, res, next) => {
    res.setHeader('X-Build-Hash', BUILD_HASH);
    next();
});


import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const db = createDatabaseClient();

await db.connect().then(() => {
    logger.info('Database client connected');
}).catch(err => {
    logger.error('Database connection failed: %O', err);
    process.exit(1);
});

app.post("/api/createStatement", async (req, res) => {
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

app.post("/api/setvalue", async (req, res) => {
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
        const data = await db.hGet(uuid, 'storyTree');
        logger.info(`Raw data from Redis: [${data}]`);

        if (!data) {
            logger.warn(`StoryTree with UUID ${uuid} not found`);
            return res.status(404).json({ error: 'StoryTree not found' });
        }

        const parsedData = JSON.parse(data);
        res.json(parsedData);
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

      let results = await db.lRange('feedItems', startIndex, endIndex); 
      logger.info('Raw db response for feed items: %O', results);

        if (results.err) {
          logger.error('db error when fetching feed: %O', results.err);
          return res.status(500).json({ error: 'Error fetching data from Redis' });
        }
  
        const feedItems = results.map((item) => {
            try {
                return JSON.parse(item);
            } catch (e) {
                logger.error('Failed to parse feed item: %O', { item, error: e });
                return null;
            }
        }).filter(Boolean);

        logger.info("Returned " + feedItems.length + " feed items");
        logger.debug("Feed items content: %O", feedItems);
        res.json({
          page,
          items: feedItems,
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
const USER_PREFIX = 'user:';
const USER_IDS_SET = 'user_ids';
const EMAIL_TO_ID_PREFIX = 'email_to_id:';

const getUserById = async (id) => {
    const userData = await db.hGet(`${USER_PREFIX}${id}`, 'data');
    if (!userData) {
        return {
            success: false,
            error: 'User not found'
        };
    }
    return {
        success: true,
        data: JSON.parse(userData)
    };
};

const getUserByEmail = async (email) => {
    // Get user ID from email mapping
    const userId = await db.get(`${EMAIL_TO_ID_PREFIX}${email}`);
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
    const existingEmail = await db.get(`${EMAIL_TO_ID_PREFIX}${email}`);
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
        await db.hSet(`${USER_PREFIX}${id}`, 'data', JSON.stringify(userData));
        // Add ID to set of user IDs
        await db.sAdd(USER_IDS_SET, id);
        // Create email to ID mapping
        await db.set(`${EMAIL_TO_ID_PREFIX}${email}`, id);

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
    max: 5, // limit each IP to 5 requests per windowMs
    message: 'Too many magic link requests from this IP, please try again later.',
});

// Routes

/**
 * @route   POST /api/auth/send-magic-link
 * @desc    Sends a magic link to the user's email for authentication
 * @access  Public
 */
app.post('/api/auth/send-magic-link', magicLinkLimiter, async (req, res) => {
    const { email } = req.body;

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
        
        // Generate magic token
        const token = generateMagicToken(email);
        const magicLink = `https://aphori.st/verify?token=${token}`;

        // Email content
        const subject = 'Your Magic Link to Sign In';
        const html = `
            <p>Hi,</p>
            <p>Click <a href="${magicLink}">here</a> to sign in. This link will expire in 15 minutes.</p>
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

    if (!token) {
        return res.status(400).json({ 
            success: false,
            error: 'Token is required'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.MAGIC_LINK_SECRET);
        const userResult = await getUserByEmail(decoded.email);

        if (!userResult.success) {
            return res.status(400).json({ 
                success: false,
                error: 'User not found'
            });
        }

        // Generate auth token
        const authToken = generateAuthToken(userResult.data);

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
        logger.error('Invalid or expired token:', error);
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
                email: userResult.data.email
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

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token required.' });
    }

    jwt.verify(token, process.env.AUTH_TOKEN_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token.' });
        }
        req.user = user;
        next();
    });
};

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

// Protected route - only authenticated users can create story trees
app.post('/api/createStoryTree', authenticateToken, async (req, res) => {
    try {
        const { storyTree } = req.body;
        if (!storyTree) {
            return res.status(400).json({ error: 'StoryTree data is required' });
        }

        // First check if this story tree already exists in Redis
        const existingStoryTree = await db.hGet(storyTree.id, 'storyTree');
        if (existingStoryTree) {
            logger.info(`Found existing StoryTree with ID: ${storyTree.id}`);
            return res.json({ id: storyTree.id });
        }

        // Generate a new UUID for the story tree if one isn't provided
        const uuid = storyTree.id || crypto.randomUUID();
        
        // Format nodes array to match frontend expectations
        const nodes = storyTree.nodes || [];

        // Create the full object for storing in Redis
        const formattedStoryTree = {
            id: uuid,
            text: storyTree.text,
            nodes: nodes,
            parentId: storyTree.parentId || null,
            metadata: {
                title: storyTree.title,
                author: storyTree.author,
                authorId: req.user.id,
                authorEmail: req.user.email,
                createdAt: new Date().toISOString()
            },
            totalNodes: nodes.length
        };

        // Store in Redis
        await db.hSet(uuid, 'storyTree', JSON.stringify(formattedStoryTree));

        // Add to feed items only if it's a root level story
        if (!storyTree.parentId) {
            const feedItem = {
                id: uuid,
                title: storyTree.title,
                text: storyTree.text,
                author: {
                    id: req.user.id,
                    email: req.user.email
                },
                createdAt: formattedStoryTree.metadata.createdAt
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
        await seedDefaultStories(db);
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
    const { id, email } = req.body;

    if (!id || !email) {
        return res.status(400).json({ 
            success: false,
            error: 'ID and email are required'
        });
    }

    const result = await createUser(id, email);
    if (!result.success) {
        return res.status(400).json(result);
    }

    logger.info(`Created new user: ${JSON.stringify(result.data)}`);
    res.json({ 
        success: true,
        message: 'User created successfully'
    });
});

// Existing routes...
app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
    logger.info(`Build hash: ${BUILD_HASH}`);
});
