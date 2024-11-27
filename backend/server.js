import express, { json } from "express";
import { createClient } from 'redis';
import newLogger from './logger.js';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { sendEmail } from './mailer.js';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

dotenv.config();

const PORT = process.env.PORT || 5000;

const logger = newLogger("server.js")

const app = express();
app.use(json());

// Parse the CORS_ORIGIN environment variable into an array
const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000'];

// Configure CORS
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if(!origin) return callback(null, true);
    
    if(allowedOrigins.indexOf(origin) === -1){
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const redisClient = createClient({
    socket: {
        port: 6379,
        host: process.env.REDIS_SERVER_IP
    }
});

redisClient.on('error', err => logger.error('Redis Client Error: %O', err));

await redisClient.connect().then(() => {
    logger.info('Redis client connected');
}).catch(err => {
    logger.error('Redis connection failed: %O', err);
    process.exit(1);
});

app.post("/api/createStatement", async (req, res) => {
    if (req.body.uuid && req.body.value) {
        try {
            const setResult = await redisClient.set(req.body.uuid, req.body.value);
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
        const value = await redisClient.get(req.params.key);
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
            const setResult = await redisClient.set(req.body.key, req.body.value);
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
        const value = await redisClient.get(req.params.key);
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
        const data = await redisClient.hGet(uuid, 'storyTree');
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
      // Fetch all feed items from Redis with pagination
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;

      let results = await redisClient.lRange('feedItems', startIndex, endIndex); 
        if (results.err) {
          return res.status(500).json({ error: 'Error fetching data from Redis' });
        }
  
        const feedItems = results.map((item) => JSON.parse(item));
        logger.info("Returned " + feedItems.length + " feed items")
        res.json({
          page,
          items: feedItems,
        });
    } catch (error) {
      res.status(500).json({ error: 'Server error' });
      logger.error('Error fetching feed items:', error);
    }
});

// Dummy user database (replace with a real database in production)
const users = []; // Example: [{ id, email }]

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
        return res.status(400).json({ error: 'Email is required.' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        logger.error(`Invalid email format: ${email}`);
        return res.status(400).json({ error: 'Invalid email format.' });
    }

    try {
        // Check if user exists, else create
        let user = users.find(u => u.email === email);
        if (!user) {
            user = { id: crypto.randomUUID(), email };
            users.push(user);
            logger.info(`Created new user with email: ${email}`);
        }

        // Generate magic token
        const token = generateMagicToken(user.email);
        const magicLink = `${process.env.FRONTEND_URL}/verify?token=${token}`;

        // Email content
        const subject = 'Your Magic Link to Sign In';
        const html = `
            <p>Hi,</p>
            <p>Click <a href="${magicLink}">here</a> to sign in. This link will expire in 15 minutes.</p>
            <p>If you did not request this email, you can safely ignore it.</p>
            <p>Thanks,<br/>Aphori.st Team</p>
        `;

        await sendEmail(user.email, subject, html);
        logger.info(`Magic link sent successfully to: ${email}`);
        res.json({ message: 'Magic link sent to your email.' });
    } catch (error) {
        logger.error('Failed to send magic link:', error);
        res.status(500).json({ error: 'Failed to send magic link.' });
    }
});

/**
 * @route   POST /api/auth/verify-magic-link
 * @desc    Verifies the magic link token and authenticates the user
 * @access  Public
 */
app.post('/api/auth/verify-magic-link', (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token is required.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.MAGIC_LINK_SECRET);
        const user = users.find(u => u.email === decoded.email);

        if (!user) {
            return res.status(400).json({ error: 'User does not exist.' });
        }

        // Generate auth token
        const authToken = generateAuthToken(user);

        res.json({ token: authToken, user: { id: user.id, email: user.email } });
    } catch (error) {
        console.error('Invalid or expired token:', error);
        res.status(400).json({ error: 'Invalid or expired token.' });
    }
});

/**
 * @route   POST /api/auth/verify-token
 * @desc    Verifies the authentication token
 * @access  Public
 */
app.post('/api/auth/verify-token', (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token is required.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.AUTH_TOKEN_SECRET);
        const user = users.find(u => u.id === decoded.id && u.email === decoded.email);

        if (!user) {
            return res.status(400).json({ error: 'Invalid token.' });
        }

        res.json({ id: user.id, email: user.email });
    } catch (error) {
        console.error('Token verification failed:', error);
        res.status(400).json({ error: 'Invalid or expired token.' });
    }
});

// Example Protected Route
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

app.listen(PORT, () => {
    logger.info(`Server is available on port ${PORT}`);
});
