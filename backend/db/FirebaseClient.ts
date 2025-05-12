import { initializeApp, App } from 'firebase-admin/app';
import { getDatabase, Database, ServerValue } from 'firebase-admin/database';
import { cert } from 'firebase-admin/app';
import crypto from 'crypto';
import { DatabaseClientInterface } from './DatabaseClientInterface.js';
import { RedisSortedSetItem } from '../types/index.js';

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
    // Use direct key/path now
    // Caller is responsible for ensuring 'key' is a valid, fully-formed Firebase path.
    // Any dynamic segments within 'key' must be pre-sanitized.
    // For example, if key is `users/${userId}`, userId must be sanitized before this call.
    this._assertFirebaseKeyComponentSafe(key, 'get', 'key (as full path, expecting pre-sanitized segments)');
    const snapshot = await this.db.ref(key).once('value');
    return snapshot.val();
  }

  async set(key: string, value: any): Promise<string | null> {
    // Use direct key/path now
    // Caller is responsible for ensuring 'key' is a valid, fully-formed Firebase path.
    // Any dynamic segments within 'key' must be pre-sanitized.
    this._assertFirebaseKeyComponentSafe(key, 'set', 'key (as full path, expecting pre-sanitized segments)');
    await this.db.ref(key).set(value);
    return 'OK';
  }

  async hGet(key: string, field: string): Promise<any> {
    // Construct path directly
    // 'key' is assumed to be a base path; dynamic segments in it must be pre-sanitized by the caller.
    this._assertFirebaseKeyComponentSafe(key, 'hGet', 'key (as base path, expecting pre-sanitized segments)');
    // 'field' is a dynamic segment and will be sanitized here by this.sanitizeKey.
    // No assertion on raw 'field' as it's immediately sanitized.
    const path = `${key}/${this.sanitizeKey(field)}`;
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.val();
  }

  async hSet(key: string, field: string, value: any): Promise<number> {
    // Construct path directly
    const { basePath, id: rawId } = this.parseKey(key); // 'id' from parseKey is raw
    // basePath from parseKey is a literal like 'users', 'posts', inherently safe.
    // No assertion for rawId as it's sanitized before use.
    // No assertion for raw field as it's sanitized before use.

    if (!basePath || !rawId) {
      console.error(`FirebaseClient hSet: Could not parse key: ${key}`);
      return 0; // Indicate error or no update
    }
    const sanitizedId = this.sanitizeKey(rawId);
    const sanitizedField = this.sanitizeKey(field); // field is a dynamic segment

    const updates: Record<string, any> = {};
    updates[sanitizedField] = value;
    // Path to update uses sanitizedId. The field key in 'updates' is also sanitized.
    await this.db.ref(`${basePath}/${sanitizedId}`).update(updates);

    return 1; // Firebase set doesn't return a count like Redis hset
  }

  /**
   * Adds an item to a Firebase path using push() to generate a unique, time-ordered key.
   * Uses the direct key if it's 'feedItems', otherwise hashes the key.
   * @param key The base path (e.g., 'feedItems').
   * @param value The value to add.
   * @returns The number 1.
   */
  async lPush(key: string, value: any): Promise<number> {
    // Use direct path for 'feedItems', hash otherwise
    const path = key; // 'key' is assumed to be a safe, pre-defined path like 'feedItems'.
    this._assertFirebaseKeyComponentSafe(path, 'lPush', 'path (key, expecting fixed or pre-sanitized)');
                     // If 'key' could be dynamic and contain user input, it would need sanitization by the caller.
    const ref = this.db.ref(path);
    try {
      let dataToPush = value;
      // Only try to parse if it looks like a JSON object/array string
      if (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
        try {
          dataToPush = JSON.parse(value);
        } catch (e) {
          // Explicitly log the parsing error if parsing was attempted
          console.error(`FirebaseClient lPush: Failed to parse potential JSON string for path ${path}. Pushing raw string. Error:`, e, 'Raw value:', value);
          // dataToPush remains the raw string in case of error
        }
      }
      // Log exactly what is being pushed
      console.log(`FirebaseClient: Pushing to path [${path}]:`, dataToPush);
      await ref.push(dataToPush);
      return 1;
    } catch (error) {
      console.error(`FirebaseClient lPush Error for path ${path}:`, error);
      throw error;
    }
  }

  // Deprecate lRange for feed items; use getFeedItemsPage instead.
  // async lRange(key: string, start: number, end: number): Promise<any[]> {

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

  /**
   * Retrieves the total item count from the fixed '/feedStats/itemCount' path.
   * @param key Ignored (expected 'feedItems').
   * @returns The count.
   */
  async lLen(key: string): Promise<number> {
    // Always read the fixed counter path, regardless of the input key
    const counterPath = 'feedStats/itemCount'; // Fixed path, inherently safe
    // 'key' is informational, not used in path construction.
    // No assertion on 'key' itself as its content doesn't affect Firebase safety here.
    if (key !== 'feedItems') {
      console.warn(`FirebaseClient lLen called with unexpected key: [${key}]. Reading ${counterPath} anyway.`);
    }
    const counterRef = this.db.ref(counterPath);
    try {
      const snapshot = await counterRef.once('value');
      const count = snapshot.val();
      return typeof count === 'number' ? count : 0;
    } catch (error) {
      console.error(`FirebaseClient lLen Error reading counter at ${counterPath}:`, error);
      throw error;
    }
  }

  async sAdd(key: string, value: any): Promise<number> {
    // 'key' is parsed into components. The raw 'key' isn't directly used as a path segment.
    // Assertions will be on the derived parentId and childId after they are extracted
    // but before sanitization to check the raw input parts.
    const parts = key.split(':');
    let path = '';
    if (parts.length === 2) {
      const collection = parts[0]; // Literal, assumed safe.
      const rawParentId = parts[1];
      const rawChildId = String(value);

      this._assertFirebaseKeyComponentSafe(rawParentId, 'sAdd', 'rawParentId from key');
      this._assertFirebaseKeyComponentSafe(rawChildId, 'sAdd', 'rawChildId from value');

      const parentId = this.sanitizeKey(rawParentId);
      const childId = this.sanitizeKey(rawChildId);

      // Path construction uses sanitized versions.
      if (collection === 'userPosts') {
        path = `userMetadata/userPosts/${parentId}/${childId}`;
      } else if (collection === 'userReplies') {
        path = `userMetadata/userReplies/${parentId}/${childId}`;
      } else if (collection === 'postReplies') { // Index replies under root post
        path = `postMetadata/postReplies/${parentId}/${childId}`;
      } else if (collection === 'parentReplies') { // Index replies under direct parent
        path = `replyMetadata/parentReplies/${parentId}/${childId}`;
      } else if (collection === 'userIds') {
        path = `userMetadata/userIds/${childId}`;
      } else if (collection === 'allPostTreeIds') {
        path = `postMetadata/allPostTreeIds/${childId}`;
      }
      else {
        console.error(`FirebaseClient sAdd: Unhandled key format or collection name: ${key}`);
        return 0;
      }
    } else {
      console.error(`FirebaseClient sAdd: Unexpected key format: ${key}. Expected 'collection:parentId'.`);
      return 0;
    }


    const ref = this.db.ref(path);
    const snapshot = await ref.once('value');

    if (!snapshot.exists()) {
      await ref.set(true);
      return 1; 
    }
    return 0; 
  }

  async sMembers(key: string): Promise<string[]> {
    // 'key' is parsed. Assertion on rawParentId derived from it.
    const parts = key.split(':');
    let path = '';
    if (parts.length === 2) {
      const collection = parts[0]; // Literal, assumed safe.
      const rawParentId = parts[1];
      this._assertFirebaseKeyComponentSafe(rawParentId, 'sMembers', 'rawParentId from key');
      const parentId = this.sanitizeKey(rawParentId);

      // Path construction uses sanitized parentId.
      if (collection === 'userPosts') {
        path = `userMetadata/userPosts/${parentId}`;
      } else if (collection === 'userReplies') {
        path = `userMetadata/userReplies/${parentId}`;
      } else if (collection === 'postReplies') {
        path = `postMetadata/postReplies/${parentId}`;
      } else if (collection === 'parentReplies') {
        path = `replyMetadata/parentReplies/${parentId}`;
      } else if (collection === 'userIds') {
        path = 'userMetadata/userIds'; 
      } else if (collection === 'allPostTreeIds') {
        path = 'postMetadata/allPostTreeIds'; 
      } else {
        console.error(`FirebaseClient sMembers: Unhandled key format or collection name: ${key}`);
        return []; 
      }
    } else {
      console.error(`FirebaseClient sMembers: Unexpected key format: ${key}. Expected 'collection:parentId'.`);
      return [];
    }

    const snapshot = await this.db.ref(path).once('value');
    const currentSet = snapshot.val() || {};
    return Object.keys(currentSet);
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

  encodeKey(key: string, prefix?: string): string {
    this._assertFirebaseKeyComponentSafe(key, 'encodeKey', 'key (raw input)');
    this._assertFirebaseKeyComponentSafe(prefix, 'encodeKey', 'prefix (raw input)');
    return prefix ? `${prefix}:${key}` : key;
  }

  async hGetAll(key: string): Promise<Record<string, any> | null> {
    // Use direct key/path
    // Caller is responsible for ensuring 'key' is a valid, fully-formed Firebase path.
    this._assertFirebaseKeyComponentSafe(key, 'hGetAll', 'key (as full path, expecting pre-sanitized segments)');
    const snapshot = await this.db.ref(key).once('value');
    return snapshot.val();
  }

  async zAdd(key: string, score: number, value: string | { id: string }): Promise<number> {
    // 'key' is used for mapping, not directly as a path segment, assertion on it before mapping.
    this._assertFirebaseKeyComponentSafe(key, 'zAdd', 'key (for basePath mapping, raw input)');
    const rawItemId = typeof value === 'object' && value.id ? value.id : String(value);
    // Assert rawItemId before sanitization.
    this._assertFirebaseKeyComponentSafe(rawItemId, 'zAdd', 'rawItemId from value');
    const itemId = this.sanitizeKey(rawItemId); 
    const timestampScore = score; 
    const uniqueKey = `${timestampScore}_${itemId}`; 

    const basePath = this.mapZSetKeyToIndexBasePath(key);
    if (!basePath) {
      console.error(`FirebaseClient zAdd: Cannot map key '${key}' to an index base path.`);
      return 0;
    }

    const ref = this.db.ref(`${basePath}/${uniqueKey}`);
    await ref.set(value);
    return 1;
  }

  async zCard(key: string): Promise<number> {
    // 'key' is used for mapping, assertion on it before mapping.
    this._assertFirebaseKeyComponentSafe(key, 'zCard', 'key (for basePath mapping, raw input)');
    const basePath = this.mapZSetKeyToIndexBasePath(key);
    if (!basePath) {
      console.error(`FirebaseClient zCard: Cannot map key '${key}' to an index base path.`);
      return 0;
    }
    const snapshot = await this.db.ref(basePath).once('value');
    return snapshot.numChildren();
  }


  // Firebase RTDB querying by range/offset (like Redis start/end) is tricky.
  // We fetch limit = end + 1 and slice.
  async zRange(key: string, start: number, end: number): Promise<any[]> {
    // 'key' is used for mapping, assertion on it before mapping.
    this._assertFirebaseKeyComponentSafe(key, 'zRange', 'key (for basePath mapping, raw input)');
    const basePath = this.mapZSetKeyToIndexBasePath(key);
    if (!basePath) {
      console.error(`FirebaseClient zRange: Cannot map key '${key}' to an index base path.`);
      return [];
    }

    // Implement cursor-based pagination
    if (start === 0) {
      // Direct fetch if starting from the beginning
      const limit = end === -1 ? 10000 : end + 1;
      const query = this.db.ref(basePath).orderByKey().limitToFirst(limit);
      const snapshot = await query.once('value');

      const results: any[] = [];
      snapshot.forEach((childSnapshot) => {
        results.push(childSnapshot.val());
      });

      return results;
    } else {
      // For pagination with offset, use a two-step process:
      // 1) Get enough keys to locate the start position
      const keysQuery = this.db.ref(basePath).orderByKey().limitToFirst(start + 1);
      const keysSnapshot = await keysQuery.once('value');

      const keys = Object.keys(keysSnapshot.val() || {});
      if (keys.length <= start) {
        // Not enough items to reach the requested offset
        return [];
      }

      const startKey = keys[start];
      this._assertFirebaseKeyComponentSafe(startKey, 'zRange', 'startKey (derived Firebase key, should be safe)');

      // 2) Fetch the actual slice starting at that key
      const limit = end === -1 ? 10000 : end - start + 1;
      const dataQuery = this.db
        .ref(basePath)
        .orderByKey()
        .startAt(startKey)
        .limitToFirst(limit);
      const dataSnapshot = await dataQuery.once('value');

      const results: any[] = [];
      dataSnapshot.forEach((childSnapshot) => {
        results.push(childSnapshot.val());
      });

      return results;
    }
  }

  async del(key: string): Promise<number> {
    // Use direct key/path
    // Caller is responsible for ensuring 'key' is a valid, fully-formed Firebase path.
    // Any dynamic segments within 'key' must be pre-sanitized.
    this._assertFirebaseKeyComponentSafe(key, 'del', 'key (as full path, expecting pre-sanitized segments)');
    await this.db.ref(key).remove();
    return 1;
  }

  /**
   * Atomically increments a numeric value stored at a path constructed from key and field.
   * Hashes key and field before constructing the path.
   * @returns The new value after incrementing.
   */
  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    const { basePath, id: rawId } = this.parseKey(key); // 'id' from parseKey is raw
    // basePath is literal. No assertion on rawId/field as they are sanitized immediately after or are literals.
    const sanitizedId = rawId ? this.sanitizeKey(rawId) : null;
    const sanitizedField = this.sanitizeKey(field);
    
    let refPath = '';

    if (basePath === 'posts' && sanitizedId && field === 'replyCount') { 
      refPath = `posts/${sanitizedId}/replyCount`;
    }
    else {
      console.warn(`FirebaseClient hIncrBy: Using generic path construction for key: ${key}, field: ${field}. Verify this is correct.`);
      if (!basePath || !sanitizedId) {
        console.error(`FirebaseClient hIncrBy: Could not parse key: ${key} for generic path construction.`);
        return 0;
      }
      refPath = `${basePath}/${sanitizedId}/${sanitizedField}`;
    }

    const ref = this.db.ref(refPath);

    const transactionResult = await ref.transaction((currentValue) => {
      const currentNumber = typeof currentValue === 'number' ? currentValue : 0;
      return currentNumber + increment;
    }, (error, committed, snapshot) => {
      // Optional callback for logging transaction outcome
      if (error) console.error(`FirebaseClient hIncrBy Transaction Error for path ${refPath}:`, error);
      else if (!committed) console.warn(`FirebaseClient hIncrBy Transaction not committed for path ${refPath}.`);
    });

    if (transactionResult.committed && transactionResult.snapshot.exists()) {
      const finalValue = transactionResult.snapshot.val();
      return typeof finalValue === 'number' ? finalValue : 0;
    } else {
      console.error(`Transaction for incrementing path ${refPath} failed or was aborted.`);
      // Fallback read attempt
      try {
        const snapshot = await ref.once('value');
        const fallbackValue = snapshot.val();
        return typeof fallbackValue === 'number' ? fallbackValue : 0;
      } catch (readError) {
        console.error(`Failed to read value at ${refPath} after transaction failure:`, readError);
        return 0;
      }
    }
  }

  async zRevRangeByScore(key: string, max: number, min: number, options?: { limit?: number }): Promise<Array<{ score: number, value: any }>> {
    // 'key' is used for mapping, assertion on it before mapping.
   this._assertFirebaseKeyComponentSafe(key, 'zRevRangeByScore', 'key (for basePath mapping, raw input)');
   const basePath = this.mapZSetKeyToIndexBasePath(key);
    if (!basePath) {
      console.error(`FirebaseClient zRevRangeByScore: Cannot map key '${key}' to an index base path.`);
      return [];
    }

    // Construct start/end keys for the query based on scores (timestamps)
    // We need to query keys >= minScore and <= maxScore
    // Since keys are timestamp_id, we use startAt/endAt with the scores
    // Need to append a boundary character to include all items with that score
    const startKey = `${min}`;          // Keys >= minScore_
    const endKey = `${max}~`;         // Keys <= maxScore_ (high Unicode char)
    // These derived keys are used directly by Firebase, assuming numeric scores are safe.
    // If scores could contain forbidden chars, they'd need sanitization too.

    let query = this.db.ref(basePath)
      .orderByKey()
      .startAt(startKey)
      .endAt(endKey);

    // Firebase returns in ascending order. Limit affects items from the start.
    // To get reverse order with limit, we must use limitToLast.
    if (options?.limit) {
      query = query.limitToLast(options.limit);
    }

    const snapshot = await query.once('value');
    const results: Array<{ score: number, value: any }> = [];
    snapshot.forEach((childSnapshot) => {
      // Reconstruct the { score, value } format expected by caller
      const keyParts = childSnapshot.key?.split('_');
      const score = keyParts ? parseInt(keyParts[0], 10) : 0;
      results.push({ score: score, value: childSnapshot.val() });
    });

    // Data is already limited by limitToLast, but needs to be reversed
    return results.reverse();
  }

  // Simulate Redis ZSCAN using Firebase queries
  async zscan(key: string, cursor: string, options?: { match?: string; count?: number }): Promise<{ cursor: string | null; items: RedisSortedSetItem<string>[] }> {
    // 'key' is used for mapping. Assertion on it before mapping.
    this._assertFirebaseKeyComponentSafe(key, 'zscan', 'key (for basePath mapping, raw input)');
    // 'cursor' is a Firebase key from a previous scan, expected to be valid.
    this._assertFirebaseKeyComponentSafe(cursor, 'zscan', 'cursor (expecting valid Firebase key format)');
    const basePath = this.mapZSetKeyToIndexBasePath(key);
    if (!basePath) {
      console.error(`FirebaseClient zscan: Cannot map key '${key}' to an index base path.`);
      return { cursor: '0', items: [] };
    }

    const count = options?.count || 10;
    // Cursor is the key (timestamp_id) to start after.
    // '0' is the initial cursor for Redis scan.
    const startAfterKey = cursor && cursor !== '0' ? cursor : null;

    let query = this.db.ref(basePath).orderByKey();

    if (startAfterKey) {
      query = query.startAfter(startAfterKey);
    }

    // Fetch one extra item to determine the next cursor
    query = query.limitToFirst(count + 1);

    const snapshot = await query.once('value');
    const items: RedisSortedSetItem<string>[] = [];
    let lastKey: string | null = null;

    snapshot.forEach((childSnapshot) => {
      lastKey = childSnapshot.key;
      if (items.length < count) {
        const keyParts = childSnapshot.key?.split('_');
        const score = keyParts ? parseInt(keyParts[0], 10) : 0;
        // Assuming the stored value needs to be stringified for RedisSortedSetItem<string>
        const value = JSON.stringify(childSnapshot.val());
        items.push({ score, value });
      }
    });

    // If we fetched more items than requested, the key of the last item processed is the next cursor.
    // If we fetched count or fewer, and there was a last key, it means we reached the end.
    const nextCursor = items.length === count && lastKey ? lastKey : '0'; // '0' indicates end of scan in Redis

    // Note: MATCH option is not implemented here, would require client-side filtering.

    return { cursor: nextCursor, items };

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
    this._assertFirebaseKeyComponentSafe(key, 'hIncrementQuoteCount', 'raw key (intended as parentId)');
    this._assertFirebaseKeyComponentSafe(field, 'hIncrementQuoteCount', 'raw field (intended as hashedQuoteKey)');
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
    this._assertFirebaseKeyComponentSafe(key, 'getAllListItems', 'raw key (before sanitization)');
    // Assume direct path
    const path = this.sanitizeKey(key);
    const snapshot = await this.db.ref(path).once('value');
    const data = snapshot.val();
    if (!data || typeof data !== 'object') {
      return []; // Return empty if path doesn't exist or is not an object
    }
    return Object.values(data);
  }

  // Helper function to parse keys like 'collection:id' into path segments
  // Needs to be robust and handle various expected key formats.
  // Returns RAW, UNSANITIZED parts. Callers are responsible for sanitizing
  // the 'id' component if it's used to construct a Firebase path.
  private parseKey(key: string): { basePath: string | null, id: string | null } {
    // 'key' is parsed. Assertions on its parts will be done by the caller if necessary.
    // For internal use, we assume the format and handle derived parts.
    // This assertion checks the whole key string, which might be overly broad if it contains a colon.
    this._assertFirebaseKeyComponentSafe(key, 'parseKey', 'key (as full input string)');
    const parts = key.split(':');
    if (parts.length !== 2) {
      console.warn(`parseKey: Unexpected key format: ${key}`);
      // Fallback or specific handling? For now, assume it might be a direct path.
      // This needs careful review based on call sites.
      // Option 1: Assume it's a base path without an ID (e.g., for hGetAll on 'users')
      // return { basePath: key, id: null };
      // Option 2: Return nulls to indicate parsing failure
      return { basePath: null, id: null };
    }

    const collection = parts[0]; // Literal component, assumed safe.
    const id = parts[1]; // Raw ID component.
    let basePath = null;

    // Mapping based on the new data model structure
    switch (collection) {
      case 'users':
        basePath = 'users';
        break;
      case 'posts':
        basePath = 'posts';
        break;
      case 'replies':
        basePath = 'replies';
        break;
      // Add cases for metadata collections if needed for hSet/hGet
      // e.g., case 'userMetadata' ?
      default:
        console.warn(`parseKey: Unrecognized collection in key: ${collection}`);
        return { basePath: null, id: null }; // Parsing failed
    }

    return { basePath, id };
  }

  // Helper to map Redis-style zset keys to Firebase index paths
  private mapZSetKeyToIndexBasePath(key: string): string | null {
    // Mapping based on keys found in backend/seed.ts
    // 'key' is for mapping, not directly a path segment here.
    // Assertion on the input key.
    this._assertFirebaseKeyComponentSafe(key, 'mapZSetKeyToIndexBasePath', 'key for mapping (raw input)');

    if (key === 'replies:feed:mostRecent') {
      // Global feed of replies, ordered by timestamp
      return 'indexes/repliesFeedByTimestamp';

    } else if (key.startsWith('replies:uuid:') && key.endsWith(':mostRecent')) {
      // Key format: replies:uuid:<parentId>:quote:<quoteKey>:mostRecent
      const parts = key.split(':');
      // Ensure enough parts and check markers
      if (parts.length >= 6 && parts[0] === 'replies' && parts[1] === 'uuid' && parts[3] === 'quote' && parts[parts.length - 1] === 'mostRecent') {
        const parentId = parts[2]; // Raw parentId
        // Quote key might contain colons, join the middle parts
        const quoteKey = parts.slice(4, -1).join(':'); // Raw quoteKey
        // These raw parts are then sanitized before being used in the returned path.
        return `indexes/repliesByParentQuoteTimestamp/${this.sanitizeKey(parentId)}/${this.sanitizeKey(quoteKey)}`;
      }

    } else if (key.startsWith('replies:quote:') && key.endsWith(':mostRecent')) {
      // Key format: replies:quote:<quoteKeyOrText>:mostRecent
      const parts = key.split(':');
      if (parts.length >= 4 && parts[0] === 'replies' && parts[1] === 'quote' && parts[parts.length - 1] === 'mostRecent') {
        const quoteIdentifier = parts.slice(2, -1).join(':'); // Raw identifier
        // Index replies by quote identifier, ordered by timestamp
        // Note: This mixes quoteKey and quoteText into one index path type.
        // Consider splitting if querying specifically by hashed key vs raw text is needed.
        return `indexes/repliesByQuoteTimestamp/${this.sanitizeKey(quoteIdentifier)}`;
      }

    } else if (key.startsWith('replies:') && !key.startsWith('replies:uuid:') && !key.startsWith('replies:quote:') && key.endsWith(':mostRecent')) {
      // Key format attempts to catch: replies:<parentId>:<quoteText>:mostRecent
      const parts = key.split(':');
      // Needs at least replies:<parentId>:<text>:<mostRecent> (4 parts)
      if (parts.length >= 4 && parts[0] === 'replies' && parts[parts.length - 1] === 'mostRecent') {
        const parentId = parts[1]; // Raw parentId
        const quoteText = parts.slice(2, -1).join(':'); // Raw quoteText
        // Index replies by parent and quote text, ordered by timestamp
        return `indexes/repliesByParentTextTimestamp/${this.sanitizeKey(parentId)}/${this.sanitizeKey(quoteText)}`;
      }
    }

    // If no pattern matches, log a warning and return null
    console.warn(`mapZSetKeyToIndexBasePath: No mapping found for key: ${key}`);
    return null;
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

} 