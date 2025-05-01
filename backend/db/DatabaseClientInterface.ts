/*
Requirements:
- Implements abstract methods for database operations
- Define consistent return types for all database operations
- Match interface with Redis implementation
- Provide type safety for all method parameters
*/

import { RedisSortedSetItem } from '../types/index.js';

export abstract class DatabaseClientInterface {
  async get(key: string): Promise<any> {
    throw new Error('Method not implemented');
  }

  async set(key: string, value: any): Promise<string | null> {
    throw new Error('Method not implemented');
  }

  async hGet(key: string, field: string): Promise<any> {
    throw new Error('Method not implemented');
  }

  async hSet(key: string, field: string, value: any): Promise<number> {
    throw new Error('Method not implemented');
  }

  async lPush(key: string, value: any): Promise<number> {
    throw new Error('Method not implemented');
  }

  async lRange(key: string, start: number, end: number): Promise<any[]> {
    throw new Error('Method not implemented');
  }

  async lLen(key: string): Promise<number> {
    throw new Error('Method not implemented');
  }

  async sAdd(key: string, value: string): Promise<number> {
    throw new Error('Method not implemented');
  }

  async sMembers(key: string): Promise<string[]> {
    throw new Error('Method not implemented');
  }

  async connect(): Promise<void> {
    throw new Error('Method not implemented');
  }

  async isConnected(): Promise<boolean> {
    throw new Error('Method not implemented');
  }

  async isReady(): Promise<boolean> {
    throw new Error('Method not implemented');
  }

  encodeKey(key: string, prefix?: string): string {
    throw new Error('Method not implemented');
  }

  async hGetAll(key: string): Promise<Record<string, any> | null> {
    throw new Error('Method not implemented');
  }

  async zCard(key: string): Promise<number> {
    throw new Error('Method not implemented');
  }

  async zRange(key: string, start: number, end: number): Promise<any[]> {
    throw new Error('Method not implemented');
  }

  async zAdd(key: string, score: number, value: string): Promise<number> {
    throw new Error('Method not implemented');
  }

  async del(key: string): Promise<number> {
    throw new Error('Method not implemented');
  }

  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    throw new Error('Method not implemented');
  }

  zRevRangeByScore<T = string>(key: string, max: number, min: number, options?: { limit?: number }): Promise<RedisSortedSetItem<T>[]> {
    throw new Error('Method not implemented');
  }

  zscan(key: string, cursor: string, options?: { match?: string; count?: number }): Promise<{ cursor: string | null; items: RedisSortedSetItem<string>[] }> {
    throw new Error('Method not implemented');
  }

  abstract hIncrementQuoteCount(key: string, field: string, quoteValue: any): Promise<number>;

  abstract addFeedItem(item: any): Promise<string>;

  abstract incrementFeedCounter(amount: number): Promise<void>;
} 