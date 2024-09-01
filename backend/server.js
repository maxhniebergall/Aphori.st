import express, { json } from "express";
import path from "path"; // Add this import
import { createClient } from 'redis';
import newLogger from './logger.js';

const logger = newLogger()

const app = express();
app.use(json());

// Serve static files from the React app
app.use(express.static("../frontend/build"));

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

app.post("/setvalue", async (req, res) => {
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

app.get('/getValue/:key', async (req, res) => {
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

// The "catchall" handler: for any request that doesn't match one above, send back React's index.html file.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

app.listen(3000, () => {
    logger.info('Server is available on port 3000');
});
