/*
Requirements:
- Implement full TypeScript typing for Redis client methods
- Extend DatabaseClientInterface
- Handle Redis client connection and error events
- Provide methods for key-value, hash, list, and sorted set operations
- Support list operations including lSet for updating list elements
*/

import { createClient, RedisClientType } from 'redis';
import { DatabaseClientInterface } from './DatabaseClientInterface.js';
import newLogger from '../logger.js';
const logger = newLogger("RedisClient.js");

export class RedisClient extends DatabaseClientInterface {
  private client: RedisClientType;

  constructor(config: any) {
    super();
    this.client = createClient(config);
    this.client.on('error', (err: Error) => console.error('Redis Client Error:', err));
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  async get(key: string): Promise<any> {
    return this.client.get(key);
  }

  async set(key: string, value: any): Promise<string | null> {
    return this.client.set(key, value);
  }

  async hGet(key: string, field: string): Promise<any> {
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

  async hSet(key: string, field: string, value: any): Promise<number> {
    return this.client.hSet(key, field, value);
  }

  async lPush(key: string, value: any): Promise<number> {
    return this.client.lPush(key, value);
  }

  async lRange(key: string, start: number, end: number): Promise<any[]> {
    return this.client.lRange(key, start, end);
  }

  async lSet(key: string, index: number, value: any): Promise<void> {
    logger.info(`Redis lSet called with key: ${key}, index: ${index}`);
    try {
      await this.client.lSet(key, index, value);
      logger.info(`Redis lSet successful for index ${index}`);
    } catch (err) {
      logger.error('Redis lSet error:', err);
      throw err;
    }
  }

  async isConnected(): Promise<boolean> {
    return this.client.isReady;
  }

  async isReady(): Promise<boolean> {
    return this.client.isReady;
  }

  encodeKey(key: string, prefix: string): string {
    return prefix ? `${prefix}:${key}` : key;
  }

  async hGetAll(key: string): Promise<Record<string, any>> {
    return this.client.hGetAll(key);
  }

  async zCard(key: string): Promise<number> {
    return this.client.zCard(key);
  }

  async zRange(key: string, start: number, end: number): Promise<any[]> {
    return this.client.zRange(key, start, end);
  }

  async sAdd(key: string, value: string): Promise<number> {
    return this.client.sAdd(key, value);
  }

  async sMembers(key: string): Promise<string[]> {
    return this.client.sMembers(key);
  }

  async zAdd(key: string, score: number, value: string): Promise<number> {
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

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    logger.info(`Redis hIncrBy called with key: ${key}, field: ${field}, increment: ${increment}`);
    try {
      const result = await this.client.hIncrBy(key, field, increment);
      logger.info(`Redis hIncrBy result: ${result}`);
      return result;
    } catch (err) {
      logger.error('Redis hIncrBy error:', err);
      throw err;
    }
  }
} 