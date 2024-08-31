import express, { json } from "express"
import redis from 'redis'
import { newLogger } from "./logger.js"
const app = express()
app.use(json())

const logger = newLogger("index.js")

const redisClient = redis.createClient({
    socket: {
        port: 6379,
        host: process.env.REDIS_SERVER_IP
    }
})

redisClient.on('error', err => logger.error('Redis Client Error', err));

redisClient.connect().then(() => {
    logger.info('Redis client connected');
}).catch(err => {
    logger.error('Redis connection failed:', err);
    process.exit(1);
});


app.post("/setvalue", async (req, res) => {
    if (req.body.key && req.body.value) {
        try {
            const setResult = await redisClient.set(req.body.key, req.body.value);
            logger.debug(`Set Result: ${setResult}`);
            res.send();
        } catch (e) {
            logger.error(`Error setting value: ${e}`);
            res.json(e);
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
        logger.debug(`Fetched value for key "${req.params.key}": ${value}`);
        res.json({ value: value });
    } catch (e) {
        logger .error(`Error getting value: ${e}`);
        res.json(e);
    }
});


app.listen(3000, () => {
	logger.info('server is available on port 3000')
})

