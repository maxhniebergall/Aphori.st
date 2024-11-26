import express, { json } from "express";
import path from "path"; // Add this import
import { createClient } from 'redis';
import newLogger from './logger.js';
import cors from 'cors';
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

  

app.listen(PORT, () => {
    logger.info(`Server is available on port ${PORT}`);
});

// For debugging, you can log the allowed origins
console.log('Allowed CORS origins:', allowedOrigins);
