import { createClient } from 'redis';
import { DatabaseClientInterface } from './DatabaseClientInterface.js';
import newLogger from '../logger.js';
const logger = newLogger("RedisClient.js");

export class RedisClient extends DatabaseClientInterface {
  constructor(config) {
    super();
    this.client = createClient(config);
    this.client.on('error', err => console.error('Redis Client Error:', err));
  }

  async connect() {
    await this.client.connect();
  }

  async get(key) {
    return this.client.get(key);
  }

  async set(key, value) {
    return this.client.set(key, value);
  }

  async hGet(key, field) {
    logger.info(`Redis hGet called with key: ${key}, field: ${field}`);
    try {
      const result = await this.client.hGet(key, field);
      logger.info(`Redis hGet result type: ${typeof result}`, { result });
      return result;
    } catch (err) {
      logger.error('Redis hGet error:', err);
      throw err;
    }
  }

  async hSet(key, field, value) {
    return this.client.hSet(key, field, value);
  }

  async lPush(key, value) {
    return this.client.lPush(key, value);
  }

  async lRange(key, start, end) {
    return this.client.lRange(key, start, end);
  }

  async isConnected() {
    return this.client.isReady;
  }

  async isReady() {
    return this.client.isReady;
  }

  encodeKey(key, prefix) {
    return prefix ? `${prefix}:${key}` : key;
  }

  async hGetAll(key) {
    return this.client.hGetAll(key);
  }

  async zCard(key) {
    return this.client.zCard(key);
  }

  async zRange(key, start, end) {
    return this.client.zRange(key, start, end);
  }

  async sAdd(key, value) {
    return this.client.sAdd(key, value);
  }

  async sMembers(key) {
    return this.client.sMembers(key);
  }

  async zAdd(key, score, value) {
    logger.info(`Redis zAdd called with key: ${key}, score: ${score}, value: ${value}`);
    
    // Validate inputs
    if (typeof score !== 'number') {
        logger.error(`Invalid score type: ${typeof score}`);
        throw new Error('Score must be a number');
    }
    
    if (!key || !value) {
        logger.error('Missing required arguments');
        throw new Error('Key and value are required');
    }

    try {
        // Redis zAdd expects arguments in this order: key, [{score, value}]
        const result = await this.client.zAdd(key, [
            {
                score: score,
                value: value.toString() // Ensure value is a string
            }
        ]);
        logger.info(`zAdd result: ${result}`);
        return result;
    } catch (err) {
        logger.error('Redis zAdd error:', err);
        throw err;
    }
  }

  async del(key) {
    return this.client.del(key);
  }
} 