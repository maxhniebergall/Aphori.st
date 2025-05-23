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
import { RedisSortedSetItem, Quote } from '../types/index.js';
import logger from '../logger.js';

export class RedisClient extends DatabaseClientInterface {
  setUserDataForMigration(rawUserId: string, data: any): Promise<void> {
    throw new Error('Method not implemented.');
  }
  addUserToCatalog(rawUserId: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  setEmailToIdMapping(rawEmail: string, rawUserId: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getAllUsers(): Promise<Record<string, any> | null> {
    throw new Error('Method not implemented.');
  }
  addProcessedStartupEmail(rawEmail: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getMailerVersion(): Promise<string | null> {
    throw new Error('Method not implemented.');
  }
  setMailerVersion(version: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getMailSentListMap(): Promise<Record<string, any> | null> {
    throw new Error('Method not implemented.');
  }
  initializeMailSentList(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  clearMailSentList(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getDatabaseVersion(): Promise<any | null> {
    throw new Error('Method not implemented.');
  }
  setDatabaseVersion(versionData: any): Promise<void> {
    throw new Error('Method not implemented.');
  }
  deleteOldEmailToIdKey(oldKey: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getUser(rawUserId: string): Promise<any | null> {
    throw new Error('Method not implemented.');
  }
  getUserIdByEmail(rawEmail: string): Promise<string | null> {
    throw new Error('Method not implemented.');
  }
  createUserProfile(rawUserId: string, rawEmail: string): Promise<{ success: boolean; error?: string; data?: any; }> {
    throw new Error('Method not implemented.');
  }
  getPost(rawPostId: string): Promise<any | null> {
    throw new Error('Method not implemented.');
  }
  setPost(rawPostId: string, postData: any): Promise<void> {
    throw new Error('Method not implemented.');
  }
  addPostToGlobalSet(rawPostId: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  addPostToUserSet(rawUserId: string, rawPostId: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  incrementPostReplyCounter(rawPostId: string, incrementAmount: number): Promise<number> {
    throw new Error('Method not implemented.');
  }
  createPostTransaction(postData: any, feedItemData: any): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getReply(rawReplyId: string): Promise<any | null> {
    throw new Error('Method not implemented.');
  }
  setReply(rawReplyId: string, replyData: any): Promise<void> {
    throw new Error('Method not implemented.');
  }
  addReplyToUserSet(rawUserId: string, rawReplyId: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  addReplyToParentRepliesIndex(rawParentId: string, rawReplyId: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  addReplyToRootPostRepliesIndex(rawRootPostId: string, rawReplyId: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  createReplyTransaction(replyData: any, hashedQuoteKey: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  addReplyToGlobalFeedIndex(rawReplyId: string, score: number, replyTeaserData?: any): Promise<void> {
    throw new Error('Method not implemented.');
  }
  addReplyToParentQuoteIndex(rawParentId: string, rawHashedQuoteKey: string, rawReplyId: string, score: number): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getReplyCountByParentQuote(rawParentId: string, rawHashedQuoteKey: string, sortCriteria: string): Promise<number> {
    throw new Error('Method not implemented.');
  }
  getReplyIdsByParentQuote(rawParentId: string, rawHashedQuoteKey: string, sortCriteria: string, limit: number, cursor?: string): Promise<{ items: Array<{ score: number; value: string; }>; nextCursor: string | null; }> {
    throw new Error('Method not implemented.');
  }
  addPostToFeed(feedItemData: any): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getGlobalFeedItemCount(): Promise<number> {
    throw new Error('Method not implemented.');
  }
  incrementGlobalFeedCounter(amount: number): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getGlobalFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[]; nextCursorKey: string | null; }> {
    throw new Error('Method not implemented.');
  }
  incrementAndStoreQuoteUsage(rawParentId: string, rawHashedQuoteKey: string, quoteObject: any): Promise<number> {
    throw new Error('Method not implemented.');
  }
  getQuoteCountsForParent(rawParentId: string): Promise<Record<string, { quote: any; count: number; }> | null> {
    throw new Error('Method not implemented.');
  }
  getRawPath(path: string): Promise<any | null> {
    throw new Error('Method not implemented.');
  }
  setRawPath(path: string, value: any): Promise<void> {
    throw new Error('Method not implemented.');
  }
  updateRawPaths(updates: Record<string, any>): Promise<void> {
    throw new Error('Method not implemented.');
  }
  removeRawPath(path: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  runTransaction(path: string, transactionUpdate: (currentData: any) => any): Promise<{ committed: boolean; snapshot: any | null; }> {
    throw new Error('Method not implemented.');
  }
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

  async lLen(key: string): Promise<number> {
    return this.client.lLen(key);
  }

  async getAllListItems(key: string): Promise<any[]> {
    // Retrieve all items from the list (index 0 to -1)
    return this.client.lRange(key, 0, -1);
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
    
    if (typeof score !== 'number') {
      logger.error(`Invalid score type: ${typeof score}`);
      throw new Error('Score must be a number');
    }
    
    if (!key || !value) {
      logger.error('Missing required arguments');
      throw new Error('Key and value are required');
    }
    
    const result = await this.client.zAdd(key, [
      {
        score: score,
        value: value,
      },
    ]);
    logger.info(`Redis zAdd successful for key ${key}. Result: ${result}`);
    return result;
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

  async zRevRangeByScore<T = string>(key: string, max: number, min: number, options?: { limit?: number }): Promise<Array<{ score: number, value: T }>> {
    logger.info(`Redis zRevRangeByScore called with key: ${key}, max: ${max}, min: ${min}, options:`, options);
    
    try {
      // Use ZRANGE with REV and BYSCORE options (Redis 6.2+ recommended approach)
      const rangeArgs = ['ZRANGE', key, String(max), String(min), 'BYSCORE', 'REV', 'WITHSCORES'];
      
      if (options?.limit) {
        rangeArgs.push('LIMIT', String(0), String(options.limit));
      }
      
      logger.info(`Executing Redis command: ${rangeArgs.join(' ')}`);
      const result = await this.client.sendCommand(rangeArgs);
      
      logger.info(`zRevRangeByScore raw result:`, result);
      
      // Redis returns results as [value1, score1, value2, score2, ...]
      // Transform into array of {score, value} objects
      const items: Array<{ score: number, value: T }> = [];
      if (Array.isArray(result)) {
        for (let i = 0; i < result.length; i += 2) {
          const value = result[i];
          const score = result[i + 1];
          if (value !== undefined && score !== undefined) {
            const parsedScore = typeof score === 'string' ? parseFloat(score) :
                              typeof score === 'number' ? score :
                              Buffer.isBuffer(score) ? parseFloat(score.toString()) : 0;
            
            items.push({
              value: value as unknown as T,
              score: parsedScore
            });
          }
        }
      }
      
      return items;
    } catch (err) {
      logger.error('Redis zRevRangeByScore error:', err);
      throw err;
    }
  }

  async zscan(key: string, cursor: string = '0', options?: { match?: string; count?: number }): Promise<{ cursor: string; items: RedisSortedSetItem<string>[] }> {
    logger.info(`Redis zscan called with key: ${key}, cursor: ${cursor}, options:`, options);
    
    try {
      const scanArgs = ['ZSCAN', key, cursor];
      
      if (options?.match) {
        scanArgs.push('MATCH', options.match);
      }
      
      if (options?.count) {
        scanArgs.push('COUNT', options.count.toString());
      }
      
      logger.info(`Executing Redis command: ${scanArgs.join(' ')}`);
      const result = await this.client.sendCommand(scanArgs);
      
      if (!Array.isArray(result) || result.length !== 2) {
        throw new Error('Invalid ZSCAN response format');
      }
      
      const [nextCursor, elements] = result;
      let nextCursorStr = null;
      if (typeof nextCursor === 'string') {
        nextCursorStr = nextCursor;
      } else {
        throw new Error(`Invalid ZSCAN response format of cursor: [${nextCursor}]`);
      }
      
      // Redis returns results as [member1, score1, member2, score2, ...]
      const items: RedisSortedSetItem<string>[] = [];
      if (Array.isArray(elements)) {
        for (let i = 0; i < elements.length; i += 2) {
          const value = elements[i];
          const score = elements[i + 1];
          if (value !== undefined && score !== undefined) {
            let parsedScore = null;
            if (typeof score === 'string') {
              parsedScore = parseFloat(score);
              if (isNaN(parsedScore)) {
                throw new Error(`Invalid score format: [${score}]`);
              }
            } else if (typeof score === 'number') {
              parsedScore = score;
            } else if (Buffer.isBuffer(score)) {
              parsedScore = parseFloat(score.toString());
            } else {
              throw new Error(`Invalid score format: [${score}]`);
            }
            
            items.push({
              value: value as string,
              score: parsedScore
            });
          }
        }
      }
      
      return {
        cursor: nextCursorStr,
        items
      };
    } catch (err) {
      logger.error('Redis zscan error:', err);
      throw err;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  /**
   * Increments the count for a specific quote within a hash.
   * Stores the quote object alongside the count for retrieval.
   * Uses a Lua script for atomic operation.
   * @param key The hash key (e.g., `parentId:quoteCounts`)
   * @param field The field within the hash (unique key representing the quote)
   * @param quoteValue The full Quote object
   * @returns The new count after incrementing.
   */
  async hIncrementQuoteCount(key: string, field: string, quoteValue: Quote): Promise<number> {
    logger.info(`Redis hIncrementQuoteCount called with key: ${key}, field: ${field}, quote:`, quoteValue);
    try {
      // Lua script to atomically get current count, increment, and store quote + new count
      const script = `
        local current = redis.call('HGET', KEYS[1], ARGV[1])
        local count = 1
        if current then
          local decoded = cjson.decode(current)
          count = decoded.count + 1
        end
        local newValue = cjson.encode({ quote = cjson.decode(ARGV[2]), count = count })
        redis.call('HSET', KEYS[1], ARGV[1], newValue)
        return count
      `;
      
      // Ensure quoteValue is stringified for the Lua script
      const stringifiedQuote = JSON.stringify(quoteValue);

      // Define the script if it doesn't exist
      // Using a simple SHA1 hash of the script as its name for caching
      // Note: Redis caches scripts by SHA1 automatically, but defining helps ensure it's loaded.
      const sha1 = await this.client.scriptLoad(script);

      // Execute the script
      const result = await this.client.evalSha(sha1, {
        keys: [key],
        arguments: [field, stringifiedQuote]
      });

      if (typeof result !== 'number') {
          logger.error('Lua script for hIncrementQuoteCount did not return a number:', result);
          throw new Error('Failed to increment quote count');
      }

      logger.info(`Redis hIncrementQuoteCount successful for field ${field}. New count: ${result}`);
      return result;
    } catch (err) {
      logger.error('Redis hIncrementQuoteCount error:', err);
      if (err instanceof Error && err.message.includes('NOSCRIPT')) {
        logger.error('Lua script not found in cache, attempting to reload.');
      } else if (err instanceof Error && err.message.includes('cjson')) {
        logger.error('Lua script error likely related to cjson library. Ensure Redis has Lua scripting with cjson enabled.');
      }
      throw err;
    }
  }

  /**
   * Increments a counter key in Redis.
   * @param amount The amount to increment by.
   */
  async incrementFeedCounter(amount: number): Promise<void> {
    // Using INCRBY on a dedicated counter key.
    await this.client.incrBy('feedStats:itemCount', amount);
    // INCRBY returns the new value, but the interface is void.
  }

  /**
   * Placeholder implementation for fetching feed items by page.
   * Redis typically uses LRANGE with numerical offsets, not key cursors.
   * This needs a more sophisticated implementation if used with Redis
   * (e.g., using sorted sets or custom indexing).
   */
  async getFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }> {
    logger.warn('getFeedItemsPage Redis implementation is a basic placeholder using LRANGE. Consider a more robust approach if using Redis for feed.');
    // Basic LRANGE simulation - assumes cursorKey is parseable as start index if provided
    const start = cursorKey ? parseInt(cursorKey, 10) : 0;
    if (isNaN(start)) {
        throw new Error('Invalid cursorKey for Redis getFeedItemsPage simulation.');
    }
    const end = start + limit -1; // Fetch limit items
    // Need to handle potential JSON parsing errors for each item
    const rawItems = await this.client.lRange('feedItems', start, end);
    const items: any[] = [];
    for (const rawItem of rawItems) {
        try {
            items.push(JSON.parse(rawItem));
        } catch (e) {
            logger.error({ err: e, rawItem }, 'Failed to parse feed item from Redis LRANGE');
            // Skip invalid items
        }
    }

    // Check if there are more items (basic check)
    const nextItems = await this.client.lRange('feedItems', end + 1, end + 1);
    const nextCursorKey = nextItems.length > 0 ? (end + 1).toString() : null;

    return { items, nextCursorKey };
  }
} 