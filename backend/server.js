import express, { json } from "express";
import path from "path"; // Add this import
import { createClient } from 'redis';
import newLogger from './logger.js';
import cors from 'cors';
const PORT = process.env.PORT || 5000;

const logger = newLogger()

const app = express();
app.use(json());

const corsOptions = {
    origin: 'http://localhost:3000', // Frontend URL
    optionsSuccessStatus: 200
  };
app.use(cors(corsOptions));

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
    console.log(`Fetching storyTree with UUID: ${uuid}`);
    const data = await redisClient.hGet('storyTrees', uuid);
    console.log('Raw data from Redis:', data);

    if (!data) {
    console.warn(`StoryTree with UUID ${uuid} not found`);
    return res.status(404).json({ error: 'StoryTree not found' });
    }

    const parsedData = JSON.parse(data);
    res.json(parsedData);
} catch (err) {
    console.error('Error fetching data from Redis:', err.stack);
    res.status(500).json({ error: 'Server error' });
}
});

  // Get feed data with pagination
app.get('/api/feed', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = 10; // Number of items per page
  
    try {
      // Fetch all feed items from Redis
      client.lrange('feedItems', 0, -1, (err, data) => {
        if (err) {
          return res.status(500).json({ error: 'Error fetching data from Redis' });
        }
  
        const feedItems = data.map((item) => JSON.parse(item));
  
        // Implement pagination
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
  
        const paginatedItems = feedItems.slice(startIndex, endIndex);
  
        res.json({
          page,
          totalPages: Math.ceil(feedItems.length / pageSize),
          items: paginatedItems,
        });
      });
    } catch (error) {
      res.status(500).json({ error: 'Server error' });
    }
  });
  

app.listen(PORT, () => {
    logger.info(`Server is available on port ${PORT}`);
});
