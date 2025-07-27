/*
Requirements:
- Implements abstract methods for database operations
- Define consistent return types for all database operations
- Match interface with Redis implementation
- Provide type safety for all method parameters
*/

// import { RedisSortedSetItem } from '../types/index.js'; // Unused import - commented out

export abstract class DatabaseClientInterface {


  async connect(): Promise<void> {
    throw new Error('Method not implemented');
  }

  async isConnected(): Promise<boolean> {
    throw new Error('Method not implemented');
  }

  async isReady(): Promise<boolean> {
    throw new Error('Method not implemented');
  }

  abstract incrementFeedCounter(amount: number): Promise<void>;

  abstract getFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }>;

  // --- Semantic Methods: User Management ---
  abstract getUser(rawUserId: string): Promise<any | null>;
  abstract getUserIdByEmail(rawEmail: string): Promise<string | null>;
  abstract createUserProfile(rawUserId: string, rawEmail: string): Promise<{ success: boolean, error?: string, data?: any }>;
  abstract setUserDataForMigration(rawUserId: string, data: any): Promise<void>;
  abstract addUserToCatalog(rawUserId: string): Promise<void>;
  abstract setEmailToIdMapping(rawEmail: string, rawUserId: string): Promise<void>;
  abstract getAllUsers(): Promise<Record<string, any> | null>;

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

  // --- Semantic Methods: Startup Mailer ---
  abstract addProcessedStartupEmail(rawEmail: string): Promise<void>;
  abstract getMailerVersion(): Promise<string | null>;
  abstract setMailerVersion(version: string): Promise<void>;
  abstract getMailSentListMap(): Promise<Record<string, any> | null>;
  abstract initializeMailSentList(): Promise<void>;
  abstract clearMailSentList(): Promise<void>;

  // --- Semantic Methods: Migration Specific ---
  abstract getDatabaseVersion(): Promise<any | null>;
  abstract setDatabaseVersion(versionData: any): Promise<void>;
  abstract deleteOldEmailToIdKey(oldKey: string): Promise<void>; // Specific deletion for migration

  // --- Semantic Methods: Low-Level Generic ---
  abstract getRawPath(path: string): Promise<any | null>;
  abstract setRawPath(path: string, value: any): Promise<void>;
  abstract updateRawPaths(updates: Record<string, any>): Promise<void>;
  abstract removeRawPath(path: string): Promise<void>;
  abstract runTransaction(path: string, transactionUpdate: (currentData: any) => any): Promise<{ committed: boolean, snapshot: any | null }>;
} 