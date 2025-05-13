import { initializeApp} from 'firebase-admin/app';
import { getDatabase, Database, ServerValue } from 'firebase-admin/database';
import { cert } from 'firebase-admin/app';
import { DatabaseClientInterface } from './DatabaseClientInterface.js';
import { VectorIndexMetadata, VectorIndexEntry, VectorDataForFaiss } from '../types/index.js';


interface FirebaseConfig {
  credential: any;
  databaseURL: string;
}

export class FirebaseClient extends DatabaseClientInterface {
  private db: Database;

  constructor(config: FirebaseConfig) {
    super();

    let appOptions: any = {
      databaseURL: config.databaseURL
    };

    // Only add credentials if they are provided (i.e., not using emulator)
    if (config.credential) {
      appOptions.credential = cert(config.credential);
    } else {
      // Log if we are connecting without explicit credentials (likely emulator)
      console.log('Initializing Firebase Admin SDK without explicit credentials (connecting to emulator).');
    }

    const app = initializeApp(appOptions);
    this.db = getDatabase(app);
  }

  async connect(): Promise<void> {
    // Firebase connects automatically, but we need to verify the connection
    // before declaring the client ready, especially for the emulator.
    return new Promise((resolve, reject) => {
      const connectedRef = this.db.ref('.info/connected');

      // 15 second timeout to bail out if we never connect
      const timeoutId = setTimeout(() => {
        connectedRef.off('value', onValue);
        reject(new Error('Connection check timed out'));
      }, 15_000);

      // single named listener for both success and later removal
      function onValue(snap: any) {
        if (snap.val() === true) {
          clearTimeout(timeoutId);
          connectedRef.off('value', onValue);
          console.log('Firebase Realtime Database connection verified.');
          resolve();
        }
      }

      // wire up the listener + inline error handler
      connectedRef.on(
        'value',
        onValue,
        (error: any) => {
          clearTimeout(timeoutId);
          connectedRef.off('value', onValue);
          console.error('Firebase Realtime Database connection check failed:', error);
          reject(error);
        }
      );

    });
  }


  async get(key: string): Promise<any> {
    this._assertFirebaseKeyComponentSafe(key, 'get', 'key (as full path, expecting pre-sanitized segments)');
    const snapshot = await this.db.ref(key).once('value');
    return snapshot.val();
  }

  /**
   * Fetches a page of feed items from the fixed 'feedItems' path.
   * @param limit Max items.
   * @param cursorKey Firebase key to end before.
   * @returns Items and next cursor key.
   */
  async getFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }> {
    // Use the fixed, unhashed path for the global feed
    const feedItemsRef = this.db.ref('feedItems'); // Fixed path, inherently safe
    // cursorKey is a Firebase key, expected to be already valid (potentially percent-encoded).
    this._assertFirebaseKeyComponentSafe(cursorKey, 'getFeedItemsPage', 'cursorKey (expecting valid Firebase key format)');
    let query = feedItemsRef.orderByKey();

    if (typeof cursorKey === 'string' && cursorKey) {
      query = query.endBefore(cursorKey);
    }
    query = query.limitToLast(limit + 1);

    const snapshot = await query.once('value');
    if (!snapshot.exists()) {
      return { items: [], nextCursorKey: null };
    }

    const itemsData = snapshot.val() || {};
    const sortedKeys = Object.keys(itemsData).sort().reverse();

    let nextCursorKey: string | null = null;
    let keysForPage: string[] = [];

    if (sortedKeys.length > limit) {
      nextCursorKey = sortedKeys[limit];
      keysForPage = sortedKeys.slice(0, limit);
    } else {
      keysForPage = sortedKeys;
    }

    const itemsForPage = keysForPage.map(key => itemsData[key]);
    return { items: itemsForPage, nextCursorKey };
  }

  async isConnected(): Promise<boolean> {
    // Check the actual connection status using Firebase's built-in mechanism
    try {
      const connectedRef = this.db.ref('.info/connected');
      const snapshot = await connectedRef.once('value');
      return !!snapshot.val();
    } catch (error) {
      console.error('Error checking Firebase connection status:', error);
      return false;
    }
  }

  async isReady(): Promise<boolean> {
    // Can reuse isConnected or additional checks
    return this.isConnected();
  }


  // Atomically sets or increments a quote count using a transaction
  /**
   * Stores the quote object along with the count.
   * @param key 
   * @param field 
   * @param quoteValue The actual Quote object being referenced.
   * @returns The new count after the increment.
   * @throws {Error} If the Firebase transaction fails after internal retries.
   *                 (Handled: Propagated to callers like server.ts routes).
   */
  async hIncrementQuoteCount(key: string, field: string, quoteValue: any): Promise<number> {
    // Assert raw inputs before they are sanitized.
    const parentId = this.sanitizeKey(key);
    const hashedQuoteKey = this.sanitizeKey(field);
    

    // Path structure from model: /replyMetadata/quoteCounts/$parentId/$hashedQuoteKey
    const refPath = `replyMetadata/quoteCounts/${parentId}/${hashedQuoteKey}`;
    const ref = this.db.ref(refPath);

    const transactionResult = await ref.transaction((currentData) => {
      if (currentData === null) {
        return { quote: quoteValue, count: 1 };
      } else {
        if (!currentData.quote) currentData.quote = quoteValue;
        currentData.count = (currentData.count || 0) + 1;
        return currentData;
      }
    });

    if (transactionResult.committed && transactionResult.snapshot.exists()) {
      return transactionResult.snapshot.val().count;
    } else {
      console.error(`Transaction for ${refPath} failed or was aborted.`);
      throw new Error(`Failed to update quote count for ${refPath}`);
    }
  }

  /**
   * Atomically increments/decrements the counter at the fixed 'feedStats/itemCount' path.
   * @param amount Amount to increment by.
   */
  async incrementFeedCounter(amount: number): Promise<void> {
    // Use the fixed, unhashed path 'feedStats/itemCount'
    const counterRef = this.db.ref('feedStats/itemCount'); // Fixed path, inherently safe
    const transactionResult = await counterRef.transaction((currentValue) => {
      return (currentValue || 0) + amount;
    });
    if (!transactionResult.committed) {
      console.error('Transaction for incrementing feed counter failed or was aborted.');
      throw new Error('Failed to update feed item counter.');
    }
  }

  /**
   * Removes data at a specified fixed path (does not hash the path).
   * Use with caution, primarily for administrative tasks like clearing data.
   * @param path The exact path to remove.
   * @returns Promise<void>
   */
  async removePath(path: string): Promise<void> {
    if (!path || typeof path !== 'string') {
      throw new Error('Invalid path provided to removePath.');
    }
    // Path is used directly, expecting pre-sanitized segments if dynamic.
    this._assertFirebaseKeyComponentSafe(path, 'removePath', 'path (expecting pre-sanitized segments)');
    // this.logger.warn({ path }, 'Removing data at fixed path.'); // Logging removed, handled by caller if needed
    await this.db.ref(path).remove();
  }

  /**
   * Reads data from a specified fixed path (does not hash the path).
   * @param path The exact path to read from.
   * @returns Promise<any> The data at the specified path, or null if it doesn't exist.
   */
  async readPath(path: string): Promise<any> {
    if (!path || typeof path !== 'string') {
      throw new Error('Invalid path provided to readPath.');
    }
    // Path is used directly, expecting pre-sanitized segments if dynamic.
    this._assertFirebaseKeyComponentSafe(path, 'readPath', 'path (expecting pre-sanitized segments)');
    // this.logger.debug({ path }, 'Reading data from fixed path.'); // Logging removed, handled by caller if needed
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.val();
  }

  /**
   * Retrieves all list items (values of children) under a given path.
   * Primarily used for retrieving lists created via push() like the imported post ID list.
   * Assumes the key itself is hashed if it's not a fixed path like 'feedItems'.
   * @param key The list key (will be hashed if not 'feedItems').
   * @returns An array containing the values of all children under the path.
   */
  async getAllListItems(key: string): Promise<any[]> {
    // Assert raw key before sanitization
    // Assume direct path
    const path = this.sanitizeKey(key);
    const snapshot = await this.db.ref(path).once('value');
    const data = snapshot.val();
    if (!data || typeof data !== 'object') {
      return []; // Return empty if path doesn't exist or is not an object
    }
    return Object.values(data);
  }

  sanitizeKey(key: string): string {
    // No assertion here as this IS the sanitization function.
    return this.escapeFirebaseKeyPercentEncoding(key);
  }

  /**
   * Escapes a string for use as a Firebase key using percent-encoding.
   * Note: This makes keys less human-readable in the Firebase console.
   * It encodes *all* characters that are not alphanumeric or one of "-_".
   * This is often more robust than custom replacements if inputs are unpredictable.
   *
   * @param input The string to escape.
   * @returns A string safe to use as an RTDB key.
   */
  escapeFirebaseKeyPercentEncoding(input: string): string {
    // No assertion here.
    // Encode the entire string
    let encoded = encodeURIComponent(input);

    // decodeURIComponent/encodeURIComponent handle most things, but we need
    // to ensure Firebase specific forbidden chars are handled, AND that
    // the '%' from encoding itself is handled if needed (though '%' is allowed in keys).
    // Let's replace the specific forbidden Firebase chars AFTER encoding,
    // ensuring they use percent codes unlikely to clash.

    // Firebase forbidden: '.', '$', '#', '[', ']', '/'
    // Their standard percent encodings: %2E, %24, %23, %5B, %5D, %2F

    // Let's ensure these specific ones are encoded this way.
    // encodeURIComponent usually does this already, but double-checking ensures compliance.
    encoded = encoded.replace(/\./g, '%2E');
    encoded = encoded.replace(/\$/g, '%24');
    encoded = encoded.replace(/#/g, '%23');
    encoded = encoded.replace(/\[/g, '%5B');
    encoded = encoded.replace(/\]/g, '%5D');
    encoded = encoded.replace(/\//g, '%2F');

    // '.' is often left alone by encodeURIComponent for historical reasons,
    // so explicitly replacing it is important. The others are usually handled.

    return encoded;
  }

  /**
   * Unescapes a Firebase key that was percent-encoded.
   *
   * @param input The escaped key string.
   * @returns The original string.
   */
  unescapeFirebaseKeyPercentEncoding(input: string): string {
    // No assertion here.
    try {
      // No special replacements needed here, decodeURIComponent handles %XX codes.
      return decodeURIComponent(input);
    } catch (e) {
      // Handle potential URIError if the input is malformed
      console.error("Failed to decode Firebase key:", input, e);
      return input; // Or throw an error, depending on desired behavior
    }
  }

  // Assertion helper
  private _keyComponentContainsForbiddenChars(keyComponent: string): boolean {
    return /[.#$[\]/]/.test(keyComponent);
  }

  private _assertFirebaseKeyComponentSafe(keyComponent: string | null | undefined, functionName: string, argName: string): void {
    if (keyComponent && this._keyComponentContainsForbiddenChars(keyComponent)) {
        console.warn(`FirebaseClient: ${functionName} called with ${argName} ("${keyComponent}") containing raw forbidden characters. It should be pre-sanitized by the caller or this function should explicitly sanitize it if it's a dynamic segment.`);
        // In a stricter development environment, one might throw an error here:
        // throw new Error(`FirebaseClient: ${functionName} received ${argName} ("${keyComponent}") with forbidden characters.`);
    }
  }

  // --- Semantic Methods: User Management ---
  async getUser(rawUserId: string): Promise<any | null> {
    const userId = this.sanitizeKey(rawUserId);
    const path = `users/${userId}`;
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.val();
  }

  async getUserIdByEmail(rawEmail: string): Promise<string | null> {
    // Email must be escaped for Firebase key
    const escapedEmail = this.sanitizeKey(rawEmail);
    const path = `userMetadata/emailToId/${escapedEmail}`;
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.exists() ? snapshot.val() : null;
  }

  async createUserProfile(rawUserId: string, rawEmail: string): Promise<{ success: boolean, error?: string, data?: any }> {
    // Transactional user creation: check for existing userId/email, then write user, emailToId, userIds
    const userId = this.sanitizeKey(rawUserId);
    const escapedEmail = this.sanitizeKey(rawEmail);
    const userPath = `users/${userId}`;
    const emailToIdPath = `userMetadata/emailToId/${escapedEmail}`;
    const userIdsPath = `userMetadata/userIds/${userId}`;
    // Check for existing userId or email
    const [userSnap, emailSnap] = await Promise.all([
      this.db.ref(userPath).once('value'),
      this.db.ref(emailToIdPath).once('value'),
    ]);
    if (userSnap.exists()) {
      return { success: false, error: 'User ID already exists' };
    }
    if (emailSnap.exists()) {
      return { success: false, error: 'Email already registered' };
    }
    // Create user profile
    const userData = { id: rawUserId, email: rawEmail, createdAt: new Date().toISOString() };
    const updates: Record<string, any> = {};
    updates[userPath] = userData;
    updates[emailToIdPath] = rawUserId;
    updates[userIdsPath] = true;
    await this.db.ref().update(updates);
    return { success: true, data: userData };
  }

  async setUserDataForMigration(rawUserId: string, data: any): Promise<void> {
    const userId = this.sanitizeKey(rawUserId);
    const path = `users/${userId}`;
    await this.db.ref(path).set(data);
  }

  async addUserToCatalog(rawUserId: string): Promise<void> {
    const userId = this.sanitizeKey(rawUserId);
    const path = `userMetadata/userIds/${userId}`;
    await this.db.ref(path).set(true);
  }

  async setEmailToIdMapping(rawEmail: string, rawUserId: string): Promise<void> {
    this._assertFirebaseKeyComponentSafe(rawUserId, 'setEmailToIdMapping', 'rawUserId');
    const escapedEmail = this.sanitizeKey(rawEmail);
    // Store the raw user ID as the value
    const path = `userMetadata/emailToId/${escapedEmail}`;
    await this.db.ref(path).set(rawUserId);
  }

  async getAllUsers(): Promise<Record<string, any> | null> {
    const path = `users`;
    const snapshot = await this.db.ref(path).once('value');
    if (!snapshot.exists()) {
        return null;
    }
    const usersData: Record<string, any> = snapshot.val();
    // Note: User IDs stored as keys might need unescaping if they were originally escaped,
    // but typically we use sanitized keys here and store raw IDs in the object value.
    // Adjust if your structure differs.
    return usersData;
  }

  // --- Semantic Methods: Post Management ---
  async getPost(rawPostId: string): Promise<any | null> {
    const postId = this.sanitizeKey(rawPostId);
    const path = `posts/${postId}`;
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.val();
  }

  async setPost(rawPostId: string, postData: any): Promise<void> {
    const postId = this.sanitizeKey(rawPostId);
    const path = `posts/${postId}`;
    await this.db.ref(path).set(postData);
  }

  async addPostToGlobalSet(rawPostId: string): Promise<void> {
    const postId = this.sanitizeKey(rawPostId);
    const path = `postMetadata/allPostTreeIds/${postId}`;
    await this.db.ref(path).set(true);
  }

  async addPostToUserSet(rawUserId: string, rawPostId: string): Promise<void> {
    const userId = this.sanitizeKey(rawUserId);
    const postId = this.sanitizeKey(rawPostId);
    const path = `userMetadata/userPosts/${userId}/${postId}`;
    await this.db.ref(path).set(true);
  }

  async incrementPostReplyCounter(rawPostId: string, incrementAmount: number): Promise<number> {
    const postId = this.sanitizeKey(rawPostId);
    const refPath = `posts/${postId}/replyCount`;
    const ref = this.db.ref(refPath);
    const transactionResult = await ref.transaction((currentValue) => {
      return (typeof currentValue === 'number' ? currentValue : 0) + incrementAmount;
    });
    if (transactionResult.committed && transactionResult.snapshot.exists()) {
      const finalValue = transactionResult.snapshot.val();
      return typeof finalValue === 'number' ? finalValue : 0;
    }
    // Fallback read
    const fallbackSnap = await ref.once('value');
    return fallbackSnap.val() || 0;
  }

  async createPostTransaction(postData: any, feedItemData: any): Promise<void> {
    // Multi-path update: set post, add to allPostTreeIds, add to userPosts, add to feedItems, increment feedStats/itemCount
    const postId = this.sanitizeKey(postData.id);
    const userId = this.sanitizeKey(postData.authorId);
    const postPath = `posts/${postId}`;
    const allPostTreeIdsPath = `postMetadata/allPostTreeIds/${postId}`;
    const userPostsPath = `userMetadata/userPosts/${userId}/${postId}`;
    const feedItemsPath = `feedItems`;
    const feedStatsPath = `feedStats/itemCount`;
    // Push to feedItems (need push key)
    const feedRef = this.db.ref(feedItemsPath).push();
    const updates: Record<string, any> = {};
    updates[postPath] = postData;
    updates[allPostTreeIdsPath] = true;
    updates[userPostsPath] = true;
    updates[`${feedItemsPath}/${feedRef.key as string}`] = feedItemData;
    updates[feedStatsPath] = ServerValue.increment(1);
    // Increment feedStats/itemCount using transaction
    await this.db.ref().update(updates);
  }

  // --- Semantic Methods: Reply Management ---
  async getReply(rawReplyId: string): Promise<any | null> {
    const replyId = this.sanitizeKey(rawReplyId);
    const path = `replies/${replyId}`;
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.val();
  }

  async setReply(rawReplyId: string, replyData: any): Promise<void> {
    const replyId = this.sanitizeKey(rawReplyId);
    const path = `replies/${replyId}`;
    await this.db.ref(path).set(replyData);
  }

  async addReplyToUserSet(rawUserId: string, rawReplyId: string): Promise<void> {
    const userId = this.sanitizeKey(rawUserId);
    const replyId = this.sanitizeKey(rawReplyId);
    const path = `userMetadata/userReplies/${userId}/${replyId}`;
    await this.db.ref(path).set(true);
  }

  async addReplyToParentRepliesIndex(rawParentId: string, rawReplyId: string): Promise<void> {
    const parentId = this.sanitizeKey(rawParentId);
    const replyId = this.sanitizeKey(rawReplyId);
    const path = `replyMetadata/parentReplies/${parentId}/${replyId}`;
    await this.db.ref(path).set(true);
  }

  async addReplyToRootPostRepliesIndex(rawRootPostId: string, rawReplyId: string): Promise<void> {
    const rootPostId = this.sanitizeKey(rawRootPostId);
    const replyId = this.sanitizeKey(rawReplyId);
    const path = `postMetadata/postReplies/${rootPostId}/${replyId}`;
    await this.db.ref(path).set(true);
  }

  async createReplyTransaction(replyData: any, hashedQuoteKey: string): Promise<void> {
    // Sanitize all dynamic segments
    const replyId = this.sanitizeKey(replyData.id);
    const authorId = this.sanitizeKey(replyData.authorId);
    const parentId = this.sanitizeKey(replyData.parentId);
    const rootPostId = this.sanitizeKey(replyData.rootPostId);
    const score = new Date(replyData.createdAt).getTime();
    const quoteKey = this.sanitizeKey(hashedQuoteKey);

    // Paths
    const replyPath = `replies/${replyId}`;
    const feedIndexPath = `indexes/repliesFeedByTimestamp/${score}_${replyId}`;
    const parentQuoteIndexPath = `indexes/repliesByParentQuoteTimestamp/${parentId}/${quoteKey}/${score}_${replyId}`;
    const userRepliesPath = `userMetadata/userReplies/${authorId}/${replyId}`;
    const parentRepliesPath = `replyMetadata/parentReplies/${parentId}/${replyId}`;
    const rootPostRepliesPath = `postMetadata/postReplies/${rootPostId}/${replyId}`;
    const quoteCountPath = `replyMetadata/quoteCounts/${parentId}/${quoteKey}`;
    const postReplyCountPath = `posts/${rootPostId}/replyCount`;

    // Multi-path update for all non-transactional writes
    const updates: Record<string, any> = {};
    updates[replyPath] = replyData;
    updates[feedIndexPath] = replyId;
    updates[parentQuoteIndexPath] = replyId;
    updates[userRepliesPath] = true;
    updates[parentRepliesPath] = true;
    updates[rootPostRepliesPath] = true;
    // Add quote count and reply count to the same update
    updates[quoteCountPath] = { 
      quote: replyData.quote, 
      count: ServerValue.increment(1) 
    };
    updates[postReplyCountPath] = ServerValue.increment(1);

    await this.db.ref().update(updates);
  }

  // --- Semantic Methods: Feed Management / Indexing ---
  async addReplyToGlobalFeedIndex(rawReplyId: string, score: number, replyTeaserData?: any): Promise<void> {
    const replyId = this.sanitizeKey(rawReplyId);
    const uniqueKey = `${score}_${replyId}`;
    const path = `indexes/repliesFeedByTimestamp/${uniqueKey}`;
    await this.db.ref(path).set(replyTeaserData || replyId);
  }

  async addReplyToParentQuoteIndex(rawParentId: string, rawHashedQuoteKey: string, rawReplyId: string, score: number): Promise<void> {
    const parentId = this.sanitizeKey(rawParentId);
    const hashedQuoteKey = this.sanitizeKey(rawHashedQuoteKey);
    const replyId = this.sanitizeKey(rawReplyId);
    const uniqueKey = `${score}_${replyId}`;
    const path = `indexes/repliesByParentQuoteTimestamp/${parentId}/${hashedQuoteKey}/${uniqueKey}`;
    await this.db.ref(path).set(replyId);
  }

  async getReplyCountByParentQuote(rawParentId: string, rawHashedQuoteKey: string, sortCriteria: string): Promise<number> {
    // Only 'MOST_RECENT' is supported for now
    if (sortCriteria !== 'MOST_RECENT') throw new Error('Only MOST_RECENT supported');
    const parentId = this.sanitizeKey(rawParentId);
    const hashedQuoteKey = this.sanitizeKey(rawHashedQuoteKey);
    const path = `indexes/repliesByParentQuoteTimestamp/${parentId}/${hashedQuoteKey}`;
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.exists() ? snapshot.numChildren() : 0;
  }

  async getReplyIdsByParentQuote(rawParentId: string, rawHashedQuoteKey: string, sortCriteria: string, limit: number, cursor?: string): Promise<{ items: Array<{ score: number, value: string }>, nextCursor: string | null }> {
    // Only 'MOST_RECENT' is supported for now
    if (sortCriteria !== 'MOST_RECENT') throw new Error('Only MOST_RECENT supported');
    const parentId = this.sanitizeKey(rawParentId);
    const hashedQuoteKey = this.sanitizeKey(rawHashedQuoteKey);
    const path = `indexes/repliesByParentQuoteTimestamp/${parentId}/${hashedQuoteKey}`;
    let query = this.db.ref(path).orderByKey();
    if (cursor) query = query.startAfter(cursor);
    query = query.limitToFirst(limit + 1);
    const snapshot = await query.once('value');
    const items: Array<{ score: number, value: string }> = [];
    let lastKey: string | null = null;
    snapshot.forEach(child => {
      lastKey = child.key;
      if (items.length < limit) {
        const [scoreStr] = (child.key || '').split('_');
        const score = parseInt(scoreStr, 10);
        items.push({ score, value: child.val() });
      }
    });
    const nextCursor = items.length === limit && lastKey ? lastKey : null;
    return { items, nextCursor };
  }

  // --- Semantic Methods: Global Feed (List-like) ---
  async addPostToFeed(feedItemData: any): Promise<void> {
    await this.db.ref('feedItems').push(feedItemData);
  }

  async getGlobalFeedItemCount(): Promise<number> {
    const snapshot = await this.db.ref('feedStats/itemCount').once('value');
    return typeof snapshot.val() === 'number' ? snapshot.val() : 0;
  }

  async incrementGlobalFeedCounter(amount: number): Promise<void> {
    await this.db.ref('feedStats/itemCount').transaction((currentValue) => (currentValue || 0) + amount);
  }

  async getGlobalFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }> {
    const feedItemsRef = this.db.ref('feedItems');
    let query = feedItemsRef.orderByKey();
    if (typeof cursorKey === 'string' && cursorKey) {
      query = query.endBefore(cursorKey);
    }
    query = query.limitToLast(limit + 1);
    const snapshot = await query.once('value');
    if (!snapshot.exists()) {
      return { items: [], nextCursorKey: null };
    }
    const itemsData = snapshot.val() || {};
    const sortedKeys = Object.keys(itemsData).sort().reverse();
    let nextCursorKey: string | null = null;
    let keysForPage: string[] = [];
    if (sortedKeys.length > limit) {
      nextCursorKey = sortedKeys[limit];
      keysForPage = sortedKeys.slice(0, limit);
    } else {
      keysForPage = sortedKeys;
    }
    const itemsForPage = keysForPage.map(key => itemsData[key]);
    return { items: itemsForPage, nextCursorKey };
  }

  // --- Semantic Methods: Quote Management ---
  async incrementAndStoreQuoteUsage(rawParentId: string, rawHashedQuoteKey: string, quoteObject: any): Promise<number> {
    const parentId = this.sanitizeKey(rawParentId);
    const hashedQuoteKey = this.sanitizeKey(rawHashedQuoteKey);
    const refPath = `replyMetadata/quoteCounts/${parentId}/${hashedQuoteKey}`;
    const ref = this.db.ref(refPath);
    const transactionResult = await ref.transaction((currentData) => {
      if (currentData === null) {
        return { quote: quoteObject, count: 1 };
      } else {
        if (!currentData.quote) currentData.quote = quoteObject;
        currentData.count = (currentData.count || 0) + 1;
        return currentData;
      }
    });
    if (transactionResult.committed && transactionResult.snapshot.exists()) {
      return transactionResult.snapshot.val().count;
    } else {
      throw new Error(`Failed to update quote count for ${refPath}`);
    }
  }

  async getQuoteCountsForParent(rawParentId: string): Promise<Record<string, { quote: any, count: number }> | null> {
    const parentId = this.sanitizeKey(rawParentId);
    const path = `replyMetadata/quoteCounts/${parentId}`;
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.exists() ? snapshot.val() : null;
  }

  // --- Semantic Methods: Low-Level Generic ---
  async getRawPath(path: string): Promise<any | null> {
    this._assertFirebaseKeyComponentSafe(path, 'getRawPath', 'path');
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.exists() ? snapshot.val() : null;
  }

  async setRawPath(path: string, value: any): Promise<void> {
    this._assertFirebaseKeyComponentSafe(path, 'setRawPath', 'path');
    await this.db.ref(path).set(value);
  }

  async updateRawPaths(updates: Record<string, any>): Promise<void> {
    // No assertion here; caller is responsible for safe keys
    await this.db.ref().update(updates);
  }

  async removeRawPath(path: string): Promise<void> {
    this._assertFirebaseKeyComponentSafe(path, 'removeRawPath', 'path');
    await this.db.ref(path).remove();
  }

  async runTransaction(path: string, transactionUpdate: (currentData: any) => any): Promise<{ committed: boolean, snapshot: any | null }> {
    this._assertFirebaseKeyComponentSafe(path, 'runTransaction', 'path');
    const ref = this.db.ref(path);
    const result = await ref.transaction(transactionUpdate);
    return { committed: result.committed, snapshot: result.snapshot ? result.snapshot.val() : null };
  }

  // --- Semantic Methods: Vector Search Specific (New) ---

  async getVectorIndexMetadata(): Promise<VectorIndexMetadata | null> {
    const path = 'vectorIndexMetadata';
    this._assertFirebaseKeyComponentSafe(path, 'getVectorIndexMetadata', 'path (fixed)');
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.exists() ? snapshot.val() : null;
  }

  async getAllVectorsFromShards(shardKeys: string[], faissIndexLimit: number): Promise<VectorDataForFaiss[]> {
    const allVectors: VectorDataForFaiss[] = [];
    let vectorsFetched = 0;

    for (const shardKey of shardKeys) {
      if (vectorsFetched >= faissIndexLimit) {
        console.log(`Reached FAISS index limit (${faissIndexLimit}), stopping fetching from shards.`);
        break;
      }

      const shardPath = `vectorIndexStore/${shardKey}`;
      // Assuming shardKey is already safe (e.g., 'shard_0', 'shard_1')
      this._assertFirebaseKeyComponentSafe(shardPath, 'getAllVectorsFromShards', 'shardPath');
      const snapshot = await this.db.ref(shardPath).limitToFirst(faissIndexLimit - vectorsFetched).once('value');

      if (snapshot.exists()) {
        const shardData = snapshot.val();
        for (const contentId in shardData) {
          if (vectorsFetched >= faissIndexLimit) break;
          const vectorEntry: VectorIndexEntry = shardData[contentId];
          // Ensure vector data is present and is an array
          if (vectorEntry && Array.isArray(vectorEntry.vector)) {
            allVectors.push({ 
              id: this.unescapeFirebaseKeyPercentEncoding(contentId), // Unescape the contentId key
              vector: vectorEntry.vector,
              type: vectorEntry.type
            });
            vectorsFetched++;
          } else {
            console.warn(`Skipping invalid vector entry in shard ${shardKey} for contentId ${contentId}`);
          }
        }
      }
    }
    console.log(`Fetched ${allVectors.length} vectors from ${shardKeys.length} shards.`);
    return allVectors;
  }

  async addVectorToShardStore(rawContentId: string, vectorEntry: VectorIndexEntry): Promise<void> {
    const contentId = this.sanitizeKey(rawContentId); // Sanitize contentId once
    const metadataPath = 'vectorIndexMetadata';
    const storePathRoot = 'vectorIndexStore';
    const maxShardCapacity = 10000; // Default capacity

    // Atomically update metadata (shard selection, counts, active shard)
    const metadataTransactionResult = await this.db.ref(metadataPath).transaction((currentMetadata: VectorIndexMetadata | null) => {
      const nowISO = new Date().toISOString();
      let determinedShardKeyForThisVector: string;

      if (currentMetadata === null) {
        // Initialize metadata if it doesn't exist
        console.log('Initializing new vector index metadata.');
        determinedShardKeyForThisVector = 'shard_0';
        return {
          activeWriteShard: determinedShardKeyForThisVector,
          shardCapacity: maxShardCapacity,
          totalVectorCount: 1, // First vector
          shards: {
            [determinedShardKeyForThisVector]: { count: 1, createdAt: nowISO }
          },
          lastUpdatedAt: nowISO,
        };
      }

      // Create a mutable copy for modifications
      const metadataToUpdate = JSON.parse(JSON.stringify(currentMetadata));
      if (!metadataToUpdate.shards) { // Ensure shards object exists
          metadataToUpdate.shards = {};
      }

      let activeShardKey = metadataToUpdate.activeWriteShard;
      let activeShardInfo = metadataToUpdate.shards[activeShardKey];
      const capacity = metadataToUpdate.shardCapacity || maxShardCapacity;

      // Check if active shard is full or needs initialization
      if (!activeShardInfo || activeShardInfo.count >= capacity) {
        if (activeShardInfo) {
          console.log(`Shard ${activeShardKey} is full (${activeShardInfo.count}/${capacity}). Creating new shard.`);
        } else {
          console.warn(`Active shard ${activeShardKey} info not found in metadata. Will create it or a new one.`);
          // If activeShardKey itself was problematic, we'll ensure a new, valid one is chosen.
        }
        
        const existingShardIndices = Object.keys(metadataToUpdate.shards)
          .map(key => parseInt(key.split('_')[1], 10))
          .filter(num => !isNaN(num));
        const nextShardIndex = existingShardIndices.length > 0 ? Math.max(...existingShardIndices) + 1 : 0;
        
        determinedShardKeyForThisVector = `shard_${nextShardIndex}`;
        console.log(`New active shard will be: ${determinedShardKeyForThisVector}`);

        metadataToUpdate.activeWriteShard = determinedShardKeyForThisVector;
        metadataToUpdate.shards[determinedShardKeyForThisVector] = { count: 1, createdAt: nowISO }; // New shard gets its first vector
      } else {
        // Current active shard has space
        determinedShardKeyForThisVector = activeShardKey;
        metadataToUpdate.shards[activeShardKey].count = (metadataToUpdate.shards[activeShardKey].count || 0) + 1;
      }

      // Increment total vector count
      metadataToUpdate.totalVectorCount = (metadataToUpdate.totalVectorCount || 0) + 1;
      metadataToUpdate.lastUpdatedAt = nowISO;
      
      return metadataToUpdate;
    });

    // Check transaction outcome
    if (!metadataTransactionResult.committed || !metadataTransactionResult.snapshot || !metadataTransactionResult.snapshot.exists()) {
      console.error(`Atomic metadata update transaction failed for vector ${rawContentId}. Committed: ${metadataTransactionResult.committed}`);
      throw new Error(`Atomic metadata update transaction failed for vector ${rawContentId}`);
    }

    const finalCommittedMetadata = metadataTransactionResult.snapshot.val() as VectorIndexMetadata;
    // The activeWriteShard in the committed metadata is the shard this vector was assigned to.
    const actualTargetShardKey = finalCommittedMetadata.activeWriteShard; 

    // Write the actual vector data to the determined shard.
    // This write is separate from the metadata transaction.
    const vectorDataPath = `${storePathRoot}/${actualTargetShardKey}/${contentId}`;
    try {
      await this.db.ref(vectorDataPath).set(vectorEntry);
      console.log(`Vector ${rawContentId} (ID: ${contentId}) data written to shard ${actualTargetShardKey}. Metadata and counts updated atomically.`);
    } catch (error) {
      console.error(`CRITICAL: Metadata updated for vector ${rawContentId} (shard ${actualTargetShardKey}), but FAILED to write vector data to ${vectorDataPath}:`, error);
      // Consider adding a mechanism for reconciliation or cleanup if this occurs.
      throw new Error(`Failed to write vector data for ${rawContentId} to shard ${actualTargetShardKey} after metadata update: ${(error as Error).message}`);
    }
  }

  // --- Semantic Methods: Startup Mailer ---
  async addProcessedStartupEmail(rawEmail: string): Promise<void> {
    const sanitizedEmail = this.sanitizeKey(rawEmail);
    const path = `versionLocks/mailSentList/${sanitizedEmail}`;
    await this.db.ref(path).set(true); // Mark as processed
  }

  async getMailerVersion(): Promise<string | null> {
    const path = 'versionLocks/mailVersion';
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.exists() ? snapshot.val() : null;
  }

  async setMailerVersion(version: string): Promise<void> {
    const path = 'versionLocks/mailVersion';
    await this.db.ref(path).set(version);
  }

  async getMailSentListMap(): Promise<Record<string, any> | null> {
    const path = 'versionLocks/mailSentList';
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.exists() ? snapshot.val() : null;
  }

  async initializeMailSentList(): Promise<void> {
    const path = 'versionLocks/mailSentList';
    await this.db.ref(path).set({}); // Set to empty object
  }

  async clearMailSentList(): Promise<void> {
    const path = 'versionLocks/mailSentList';
    await this.db.ref(path).remove();
  }

  // --- Semantic Methods: Migration Specific ---
  async getDatabaseVersion(): Promise<any | null> {
    const path = 'databaseVersion';
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.exists() ? snapshot.val() : null;
  }

  async setDatabaseVersion(versionData: any): Promise<void> {
    const path = 'databaseVersion';
    await this.db.ref(path).set(versionData);
  }

  async deleteOldEmailToIdKey(oldKey: string): Promise<void> {
    // This key is a root-level key from the old structure, not following the new sanitized patterns
    // It should NOT be sanitized here.
    this._assertFirebaseKeyComponentSafe(oldKey, 'deleteOldEmailToIdKey', 'oldKey (raw root key)'); 
    const path = oldKey; // Use the raw key directly as the path
    await this.db.ref(path).remove();
  }
}   