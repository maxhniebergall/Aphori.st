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

  abstract incrementFeedCounter(_amount: number): Promise<void>;

  abstract getFeedItemsPage(_limit: number, _cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }>;

  // --- Semantic Methods: User Management ---
  abstract getUser(_rawUserId: string): Promise<any | null>;
  abstract getUserIdByEmail(_rawEmail: string): Promise<string | null>;
  abstract createUserProfile(_rawUserId: string, _rawEmail: string): Promise<{ success: boolean, error?: string, data?: any }>;
  abstract setUserDataForMigration(_rawUserId: string, _data: any): Promise<void>;
  abstract addUserToCatalog(_rawUserId: string): Promise<void>;
  abstract setEmailToIdMapping(_rawEmail: string, _rawUserId: string): Promise<void>;
  abstract getAllUsers(): Promise<Record<string, any> | null>;

  // --- Semantic Methods: Post Management ---
  abstract getPost(_rawPostId: string): Promise<any | null>;
  abstract setPost(_rawPostId: string, _postData: any): Promise<void>;
  abstract addPostToGlobalSet(_rawPostId: string): Promise<void>;
  abstract addPostToUserSet(_rawUserId: string, _rawPostId: string): Promise<void>;
  abstract incrementPostReplyCounter(_rawPostId: string, _incrementAmount: number): Promise<number>;
  abstract createPostTransaction(_postData: any, _feedItemData: any): Promise<void>;

  // --- Semantic Methods: Reply Management ---
  abstract getReply(_rawReplyId: string): Promise<any | null>;
  abstract setReply(_rawReplyId: string, _replyData: any): Promise<void>;
  abstract addReplyToUserSet(_rawUserId: string, _rawReplyId: string): Promise<void>;
  abstract addReplyToParentRepliesIndex(_rawParentId: string, _rawReplyId: string): Promise<void>;
  abstract addReplyToRootPostRepliesIndex(_rawRootPostId: string, _rawReplyId: string): Promise<void>;
  abstract createReplyTransaction(_replyData: any, _hashedQuoteKey: string): Promise<void>;

  // --- Semantic Methods: Feed Management / Indexing ---
  abstract addReplyToGlobalFeedIndex(_rawReplyId: string, _score: number, _replyTeaserData?: any): Promise<void>;
  abstract addReplyToParentQuoteIndex(_rawParentId: string, _rawHashedQuoteKey: string, _rawReplyId: string, _score: number): Promise<void>;
  abstract getReplyCountByParentQuote(_rawParentId: string, _rawHashedQuoteKey: string, _sortCriteria: string): Promise<number>;
  abstract getReplyIdsByParentQuote(_rawParentId: string, _rawHashedQuoteKey: string, _sortCriteria: string, _limit: number, _cursor?: string): Promise<{ items: Array<{ score: number, value: string }>, nextCursor: string | null }>;

  // --- Semantic Methods: Global Feed (List-like) ---
  abstract addPostToFeed(_feedItemData: any): Promise<void>;
  abstract getGlobalFeedItemCount(): Promise<number>;
  abstract incrementGlobalFeedCounter(_amount: number): Promise<void>;
  abstract getGlobalFeedItemsPage(_limit: number, _cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }>;

  // --- Semantic Methods: Quote Management ---
  abstract incrementAndStoreQuoteUsage(_rawParentId: string, _rawHashedQuoteKey: string, _quoteObject: any): Promise<number>;
  abstract getQuoteCountsForParent(_rawParentId: string): Promise<Record<string, { quote: any, count: number }> | null>;

  // --- Semantic Methods: Startup Mailer ---
  abstract addProcessedStartupEmail(_rawEmail: string): Promise<void>;
  abstract getMailerVersion(): Promise<string | null>;
  abstract setMailerVersion(_version: string): Promise<void>;
  abstract getMailSentListMap(): Promise<Record<string, any> | null>;
  abstract initializeMailSentList(): Promise<void>;
  abstract clearMailSentList(): Promise<void>;

  // --- Semantic Methods: Migration Specific ---
  abstract getDatabaseVersion(): Promise<any | null>;
  abstract setDatabaseVersion(_versionData: any): Promise<void>;
  abstract deleteOldEmailToIdKey(_oldKey: string): Promise<void>; // Specific deletion for migration

  // --- Semantic Methods: Low-Level Generic ---
  abstract getRawPath(_path: string): Promise<any | null>;
  abstract setRawPath(_path: string, _value: any): Promise<void>;
  abstract updateRawPaths(_updates: Record<string, any>): Promise<void>;
  abstract removeRawPath(_path: string): Promise<void>;
  abstract runTransaction(_path: string, _transactionUpdate: (currentData: any) => any): Promise<{ committed: boolean, snapshot: any | null }>;
} 