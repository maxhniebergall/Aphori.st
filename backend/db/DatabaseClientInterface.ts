/*
Requirements:
- Implements abstract methods for database operations
- Define consistent return types for all database operations
- Match interface with Redis implementation
- Provide type safety for all method parameters
*/

import { RedisSortedSetItem } from '../types/index.js';

export abstract class DatabaseClientInterface {
  async get<T = unknown>(key: string): Promise<T | null> {
    throw new Error('Method not implemented');
  }

  async set<T = unknown>(key: string, value: T): Promise<string | null> {
    throw new Error('Method not implemented');
  }

  async hGet<T = unknown>(key: string, field: string): Promise<T | null> {
    throw new Error('Method not implemented');
  }

  async hSet<T = unknown>(key: string, field: string, value: T): Promise<number> {
    throw new Error('Method not implemented');
  }

  async lPush<T = unknown>(key: string, value: T): Promise<number> {
    throw new Error('Method not implemented');
  }

  async lRange<T = unknown>(key: string, start: number, end: number): Promise<T[]> {
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

  zRevRangeByScore<T = string>(key: string, max: number, min: number, options?: { limit?: number }): Promise<Array<{ score: number, value: T }>> {
    throw new Error('Method not implemented');
  }

  zscan(key: string, cursor: string, options?: { match?: string; count?: number }): Promise<{ cursor: string | null; items: RedisSortedSetItem<string>[] }> {
    throw new Error('Method not implemented');
  }

  abstract hIncrementQuoteCount(key: string, field: string, quoteValue: any): Promise<number>;

  abstract incrementFeedCounter(amount: number): Promise<void>;

  abstract getFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }>;

  // Add method for retrieving all items from a list-like structure
  abstract getAllListItems(key: string): Promise<any[]>;

  keys(pattern: string): Promise<string[]> {
    throw new Error('Method not implemented');
  }

  // --- Semantic Methods: User Management ---
  abstract getUser(rawUserId: string): Promise<any | null>;
  abstract getUserIdByEmail(rawEmail: string): Promise<string | null>;
  abstract createUserProfile(rawUserId: string, rawEmail: string): Promise<{ success: boolean, error?: string, data?: any }>;

  // --- Semantic Methods: Post Management ---
  abstract getPost(rawPostId: string): Promise<any | null>;
  abstract setPost(rawPostId: string, postData: any): Promise<void>;
  abstract addPostToGlobalSet(rawPostId: string): Promise<void>;
  abstract addPostToUserSet(rawUserId: string, rawPostId: string): Promise<void>;
  abstract incrementPostReplyCounter(rawPostId: string, incrementAmount: number): Promise<number>;
  abstract createPostTransaction(postData: any, feedItemData: any): Promise<void>;

  // --- Semantic Methods: Reply Management ---
  abstract getReply(rawReplyId: string): Promise<any | null>;
  abstract setReply(rawReplyId: string, replyData: any): Promise<void>;
  abstract addReplyToUserSet(rawUserId: string, rawReplyId: string): Promise<void>;
  abstract addReplyToParentRepliesIndex(rawParentId: string, rawReplyId: string): Promise<void>;
  abstract addReplyToRootPostRepliesIndex(rawRootPostId: string, rawReplyId: string): Promise<void>;
  abstract createReplyTransaction(replyData: any, hashedQuoteKey: string): Promise<void>;

  // --- Semantic Methods: Feed Management / Indexing ---
  abstract addReplyToGlobalFeedIndex(rawReplyId: string, score: number, replyTeaserData?: any): Promise<void>;
  abstract addReplyToParentQuoteIndex(rawParentId: string, rawHashedQuoteKey: string, rawReplyId: string, score: number): Promise<void>;
  abstract getReplyCountByParentQuote(rawParentId: string, rawHashedQuoteKey: string, sortCriteria: string): Promise<number>;
  abstract getReplyIdsByParentQuote(rawParentId: string, rawHashedQuoteKey: string, sortCriteria: string, limit: number, cursor?: string): Promise<{ items: Array<{ score: number, value: string }>, nextCursor: string | null }>;

  // --- Semantic Methods: Global Feed (List-like) ---
  abstract addPostToFeed(feedItemData: any): Promise<void>;
  abstract getGlobalFeedItemCount(): Promise<number>;
  abstract incrementGlobalFeedCounter(amount: number): Promise<void>;
  abstract getGlobalFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }>;

  // --- Semantic Methods: Quote Management ---
  abstract incrementAndStoreQuoteUsage(rawParentId: string, rawHashedQuoteKey: string, quoteObject: any): Promise<number>;
  abstract getQuoteCountsForParent(rawParentId: string): Promise<Record<string, { quote: any, count: number }> | null>;

  // --- Semantic Methods: Low-Level Generic ---
  abstract getRawPath(path: string): Promise<any | null>;
  abstract setRawPath(path: string, value: any): Promise<void>;
  abstract updateRawPaths(updates: Record<string, any>): Promise<void>;
  abstract removeRawPath(path: string): Promise<void>;
  abstract runTransaction(path: string, transactionUpdate: (currentData: any) => any): Promise<{ committed: boolean, snapshot: any | null }>;
} 