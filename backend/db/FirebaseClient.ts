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
    const snapshot = await this.db.ref(key).once('value');
    return snapshot.val();
  }

  async set(key: string, value: any): Promise<string | null> {
    // Use direct key/path now
    await this.db.ref(key).set(value);
    return 'OK';
  }

  async hGet(key: string, field: string): Promise<any> {
    // Construct path directly
    const path = `${key}/${field}`; // Simple concatenation, may need refinement based on usage
    const snapshot = await this.db.ref(path).once('value');
    return snapshot.val();
  }

  async hSet(key: string, field: string, value: any): Promise<number> {
    // Construct path directly
    const { basePath, id } = this.parseKey(key);
    if (!basePath || !id) {
      console.error(`FirebaseClient hSet: Could not parse key: ${key}`);
      return 0; // Indicate error or no update
    }
    const updates: Record<string, any> = {};
    updates[field] = value;
    await this.db.ref(`${basePath}/${id}`).update(updates);

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
    const path = key;
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

  /**
   * Retrieves the total item count from the fixed '/feedStats/itemCount' path.
   * @param key Ignored (expected 'feedItems').
   * @returns The count.
   */
  async lLen(key: string): Promise<number> {
    // Always read the fixed counter path, regardless of the input key
    const counterPath = 'feedStats/itemCount';
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
    // Use direct key/path
    // const ref = this.db.ref(key); // OLD

    // Escape the value to use as the child key for the set member
    // const escapedValue = this._escapeFirebaseKey(String(value)); // OLD Escape logic removed

    // NEW LOGIC based on assumed key format like 'collection:parentId' and value 'childId'
    // Needs refinement based on actual key formats used in the application
    const parts = key.split(':');
    let path = '';
    if (parts.length === 2) {
      const collection = parts[0]; // e.g., 'userPosts', 'postReplies'
      const parentId = parts[1];
      const childId = String(value); // The value is the ID to add to the set

      // Map collection names to actual paths based on the new data model
      // This mapping needs to be comprehensive based on backend_architecture.md
      if (collection === 'userPosts') {
        path = `userMetadata/userPosts/${parentId}/${childId}`;
      } else if (collection === 'userReplies') {
        path = `userMetadata/userReplies/${parentId}/${childId}`;
      } else if (collection === 'postReplies') { // Index replies under root post
        path = `postMetadata/postReplies/${parentId}/${childId}`;
      } else if (collection === 'parentReplies') { // Index replies under direct parent
        path = `replyMetadata/parentReplies/${parentId}/${childId}`;
      } else if (collection === 'userIds') {
        // Here the 'value' IS the userId, and parentId is likely 'userIds' itself or irrelevant
        path = `userMetadata/userIds/${childId}`;
      } else if (collection === 'allPostTreeIds') {
        path = `postMetadata/allPostTreeIds/${childId}`;
      }
      else {
        console.error(`FirebaseClient sAdd: Unhandled key format or collection name: ${key}`);
        // Decide on error handling: throw error or return 0?
        // For now, let's prevent writing to an unknown path
        return 0;
      }
    } else {
      console.error(`FirebaseClient sAdd: Unexpected key format: ${key}. Expected 'collection:parentId'.`);
      // Prevent writing to an unknown path
      return 0;
    }


    const ref = this.db.ref(path);
    // Check if the childId already exists as a key at this path
    const snapshot = await ref.once('value');

    if (!snapshot.exists()) {
      // If it doesn't exist, add it with a value of true
      await ref.set(true);
      return 1; // Indicate an item was added
    }
    return 0; // Indicate the item already existed
  }

  async sMembers(key: string): Promise<string[]> {
    // Use direct key/path
    // const snapshot = await this.db.ref(key).once('value'); // OLD

    // NEW LOGIC based on assumed key format like 'collection:parentId'
    const parts = key.split(':');
    let path = '';
    if (parts.length === 2) {
      const collection = parts[0];
      const parentId = parts[1];

      // Map collection names to actual paths
      if (collection === 'userPosts') {
        path = `userMetadata/userPosts/${parentId}`;
      } else if (collection === 'userReplies') {
        path = `userMetadata/userReplies/${parentId}`;
      } else if (collection === 'postReplies') {
        path = `postMetadata/postReplies/${parentId}`;
      } else if (collection === 'parentReplies') {
        path = `replyMetadata/parentReplies/${parentId}`;
      } else if (collection === 'userIds') {
        path = 'userMetadata/userIds'; // Get all user IDs
      } else if (collection === 'allPostTreeIds') {
        path = 'postMetadata/allPostTreeIds';
      } else {
        console.error(`FirebaseClient sMembers: Unhandled key format or collection name: ${key}`);
        return []; // Return empty array on error
      }
    } else {
      console.error(`FirebaseClient sMembers: Unexpected key format: ${key}. Expected 'collection:parentId'.`);
      return [];
    }

    const snapshot = await this.db.ref(path).once('value');
    const currentSet = snapshot.val() || {};
    // Get the escaped keys // OLD
    // const escapedKeys = Object.keys(currentSet); // OLD
    // Unescape each key to return the original values // OLD
    // return escapedKeys.map(escapedKey => this._unescapeFirebaseKey(escapedKey)); // OLD

    // NEW: Keys are the member IDs (e.g., postIds, replyIds), return them directly
    return Object.keys(currentSet);
  }

  async isConnected(): Promise<boolean> {
    // Firebase connects automatically
    return true;
  }

  async isReady(): Promise<boolean> {
    // Firebase is always ready after initialization
    return true;
  }

  encodeKey(key: string, prefix?: string): string {
    return prefix ? `${prefix}:${key}` : key;
  }

  async hGetAll(key: string): Promise<Record<string, any> | null> {
    // Use direct key/path
    const snapshot = await this.db.ref(key).once('value');
    return snapshot.val();
  }

  async zAdd(key: string, score: number, value: any): Promise<number> {
    // Use score directly as child key, store { score, value } object // OLD
    // Use direct key/path // OLD
    // const ref = this.db.ref(`${key}/${score}`); // OLD
    // await ref.set({ score: score, value: value }); // OLD

    // NEW LOGIC: Assume score is a timestamp. Store value under a path incorporating the timestamp.
    // The exact path structure depends on the specific sorted set.
    // Example for a global feed sorted by time: replies:feed:mostRecent
    // We might store at /repliesFeedByTimestamp/<timestamp>_<uniqueId> = value
    // Or store { value, timestamp } under /replies/<replyId> and query an index.
    // Let's assume for now zAdd targets a dedicated index path where the score (timestamp) is primary.
    // We'll use a combined key <score>_<value_id> to ensure uniqueness if scores can collide.
    // This assumes 'value' has an 'id' property or is the ID itself.

    // This implementation is a placeholder and NEEDS VERIFICATION based on call sites.
    const itemId = typeof value === 'object' && value.id ? value.id : String(value);
    const timestampScore = score; // Assuming score is the timestamp
    const uniqueKey = `${timestampScore}_${itemId}`; // Combine score and ID for unique path

    // Assume the 'key' provided tells us the base path for the index
    // e.g., key = 'replies:feed:mostRecent' -> basePath = 'indexes/repliesFeedByTimestamp'
    const basePath = this.mapZSetKeyToIndexBasePath(key);
    if (!basePath) {
      console.error(`FirebaseClient zAdd: Cannot map key '${key}' to an index base path.`);
      return 0;
    }

    const ref = this.db.ref(`${basePath}/${uniqueKey}`);
    // Store the actual value (or reference like itemId) at this timestamped key
    await ref.set(value);
    return 1;
  }

  async zCard(key: string): Promise<number> {
    // Use direct key/path // OLD
    // const snapshot = await this.db.ref(key).once('value'); // OLD
    // Count children (each child key is a score) // OLD
    // return snapshot.numChildren(); // OLD

    // NEW LOGIC: Count children at the mapped index path
    const basePath = this.mapZSetKeyToIndexBasePath(key);
    if (!basePath) {
      console.error(`FirebaseClient zCard: Cannot map key '${key}' to an index base path.`);
      return 0;
    }
    const snapshot = await this.db.ref(basePath).once('value');
    return snapshot.numChildren();
  }

  async zRange(key: string, start: number, end: number): Promise<any[]> {
    // Use direct key/path // OLD
    // const query = this.db.ref(key).orderByKey().limitToFirst(end + 1); // Fetch enough to slice // OLD
    // const snapshot = await query.once('value'); // OLD

    // const results: any[] = []; // OLD
    // snapshot.forEach((childSnapshot) => { // OLD
    //   // Key is the score, value is { score, value } // OLD
    //   results.push(childSnapshot.val().value); // Extract original value // OLD
    // }); // OLD

    // Apply the start index slice // OLD
    // return results.slice(start); // OLD

    // NEW LOGIC: Query the mapped index path, ordered by key (timestamp_id)
    const basePath = this.mapZSetKeyToIndexBasePath(key);
    if (!basePath) {
      console.error(`FirebaseClient zRange: Cannot map key '${key}' to an index base path.`);
      return [];
    }

    // Firebase RTDB querying by range/offset (like Redis start/end) is tricky.
    // We fetch limit = end + 1 and slice.
    // orderByKey() works because keys are timestamp_id.
    const limit = end === -1 ? 10000 : end - start + 1; // Adjust limit based on start/end. -1 means fetch all (up to a practical limit).
    // If start > 0, we need to fetch more items (start + limit) and slice
    // However, Firebase doesn't have a direct offset. We might need cursors or fetch more data.
    // Let's fetch limit items starting from the beginning for simplicity FOR NOW.
    // THIS IS INEFFICIENT FOR LARGE OFFSETS (start > 0)!

    const query = this.db.ref(basePath).orderByKey().limitToFirst(limit); // Fetching potentially more than needed if start > 0
    const snapshot = await query.once('value');

    const results: any[] = [];
    snapshot.forEach((childSnapshot) => {
      results.push(childSnapshot.val()); // The value stored directly
    });

    // Manual slicing - highly inefficient if start is large
    if (start > 0 && end !== -1) {
      console.warn(`FirebaseClient zRange: Slicing results for start=${start} is inefficient.`);
      // This slice assumes we fetched enough items, which might not be true if start is large.
      // A cursor-based approach would be better.
      return results.slice(start);
    } else if (end === -1) {
      return results.slice(start);
    } else {
      return results; // Already limited to approx the correct count (if start was 0)
    }
  }

  async del(key: string): Promise<number> {
    // Use direct key/path
    await this.db.ref(key).remove();
    return 1;
  }

  /**
   * Atomically increments a numeric value stored at a path constructed from key and field.
   * Hashes key and field before constructing the path.
   * @returns The new value after incrementing.
   */
  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    // Construct path directly // OLD
    // const refPath = `${key}/${field}`; // Simple concatenation, may need refinement based on usage // OLD
    // const ref = this.db.ref(refPath); // OLD

    // NEW LOGIC: Construct path based on parsed key and specific field logic
    // Example: key = 'posts:postId', field = 'replyCount' -> path = 'posts/postId/replyCount'
    // Example: key = 'quoteCounts:parentId', field = 'hashedQuoteKey' -> path = 'replyMetadata/quoteCounts/parentId/hashedQuoteKey/count'

    const { basePath, id } = this.parseKey(key); // Assume key format like 'collection:id'
    let refPath = '';

    // Special case: key is 'posts:postId' and field is 'replyCount'
    if (basePath === 'posts' && id && field === 'replyCount') {
      refPath = `posts/${id}/replyCount`;
    }
    // Add other specific counter paths here based on the data model
    // else if (basePath === 'someCounterCollection' && id) { ... }
    else {
      // Attempt a generic path construction, but log a warning as it might be incorrect
      console.warn(`FirebaseClient hIncrBy: Using generic path construction for key: ${key}, field: ${field}. Verify this is correct.`);
      if (!basePath || !id) {
        console.error(`FirebaseClient hIncrBy: Could not parse key: ${key} for generic path construction.`);
        return 0;
      }
      refPath = `${basePath}/${id}/${field}`;
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
    // Use direct key/path // OLD
    // let query = this.db.ref(key).orderByKey(); // OLD

    // Use string representation for range queries on numeric keys // OLD
    // const minStr = String(min); // OLD
    // const maxStr = String(max); // OLD
    // query = query.startAt(minStr).endAt(maxStr); // OLD

    // Apply limit if provided // OLD
    // if (options?.limit) { // OLD
    // Cannot directly limit with start/end AND get correct reverse order easily. // OLD
    // Fetch all in range, then sort/limit in code. // OLD
    // For large ranges, this is inefficient. Consider alternative structure if performance critical. // OLD
    // } // OLD

    // const snapshot = await query.once('value'); // OLD
    // const results: Array<{ score: number, value: any }> = []; // OLD
    // snapshot.forEach((childSnapshot) => { // OLD
    //   results.push(childSnapshot.val()); // Value is { score, value } // OLD
    // }); // OLD

    // Sort descending by score and apply limit // OLD
    // results.sort((a, b) => b.score - a.score); // OLD
    // if (options?.limit) { // OLD
    //   return results.slice(0, options.limit); // OLD
    // } // OLD
    // return results; // OLD

    // NEW LOGIC: Query mapped index path, order by key (timestamp_id), filter by score range
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
    const endKey = `${max}~`;         // Keys <= maxScore_￿ (high Unicode char)

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
    // const count = options?.count || 10; // OLD
    // Cursor is the score (as string key) to start after // OLD
    // const startAfterKey = cursor && cursor !== '0' ? cursor : null; // OLD

    // let query = this.db.ref(key).orderByKey(); // Order by score (key) // OLD

    // if (startAfterKey) { // OLD
    //   query = query.startAfter(startAfterKey); // OLD
    // } // OLD

    // query = query.limitToFirst(count + 1); // OLD

    // const snapshot = await query.once('value'); // OLD
    // const items: RedisSortedSetItem<string>[] = []; // OLD
    // snapshot.forEach((childSnapshot) => { // OLD
    //   const data = childSnapshot.val(); // OLD
    //   // Value is { score, value } // OLD
    //   if (data && typeof data.score === 'number' && typeof data.value !== 'undefined') { // OLD
    //     // Convert value to string for RedisSortedSetItem compatibility if needed, or adjust type // OLD
    //     items.push({ score: data.score, value: String(data.value) }); // OLD
    //   } else { // OLD
    //     console.warn(`Invalid data structure in sorted set ${key}:`, data); // Use direct key in warning // OLD
    //   } // OLD
    // }); // OLD

    // let nextCursor: string | null = null; // OLD
    // if (items.length > count) { // OLD
    //   const lastItem = items.pop(); // Remove extra item // OLD
    //   if (lastItem) { // OLD
    //     nextCursor = String(lastItem.score); // Next cursor is the score of the last item fetched // OLD
    //   } // OLD
    // } // OLD

    // return { cursor: nextCursor, items }; // OLD

    // NEW LOGIC: Paginate through mapped index using orderByKey and startAfter
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
   * Atomically increments a quote count associated with a specific field (quoteKey) within a hash (parent node).
   * Stores the quote object along with the count.
   * @param key The key of the hash (e.g., parentId:quoteCounts).
   * @param field The field within the hash, representing the quote (e.g., generated quote key).
   * @param quoteValue The actual Quote object being referenced.
   * @returns The new count after the increment.
   * @throws {Error} If the Firebase transaction fails after internal retries.
   *                 (Handled: Propagated to callers like server.ts routes).
   */
  async hIncrementQuoteCount(key: string, field: string, quoteValue: any): Promise<number> {
    // Construct path directly // OLD
    // const refPath = `${key}/${field}`; // Simple concatenation, may need refinement based on usage // OLD
    // const ref = this.db.ref(refPath); // OLD

    // NEW LOGIC: Assume key format 'replyMetadata:quoteCounts:parentId' and field is hashedQuoteKey
    // Or perhaps key is just parentId? Need to check call site. Assuming key is parentId for now.
    const parentId = key; // Assuming the key IS the parentId here
    const hashedQuoteKey = field; // Assuming the field IS the hashedQuoteKey

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
    const counterRef = this.db.ref('feedStats/itemCount');
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
    // Assume direct path
    const path = key;
    const snapshot = await this.db.ref(path).once('value');
    const data = snapshot.val();
    if (!data || typeof data !== 'object') {
      return []; // Return empty if path doesn't exist or is not an object
    }
    return Object.values(data);
  }

  // Helper function to parse keys like 'collection:id' into path segments
  // Needs to be robust and handle various expected key formats.
  private parseKey(key: string): { basePath: string | null, id: string | null } {
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

    const collection = parts[0];
    const id = parts[1];
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

    if (key === 'replies:feed:mostRecent') {
      // Global feed of replies, ordered by timestamp
      return 'indexes/repliesFeedByTimestamp';

    } else if (key.startsWith('replies:uuid:') && key.endsWith(':mostRecent')) {
      // Key format: replies:uuid:<parentId>:quote:<quoteKey>:mostRecent
      const parts = key.split(':');
      // Ensure enough parts and check markers
      if (parts.length >= 6 && parts[0] === 'replies' && parts[1] === 'uuid' && parts[3] === 'quote' && parts[parts.length - 1] === 'mostRecent') {
        const parentId = parts[2];
        // Quote key might contain colons, join the middle parts
        const quoteKey = parts.slice(4, -1).join(':');
        // Index replies by parent and quote, ordered by timestamp
        return `indexes/repliesByParentQuoteTimestamp/${this.sanitizeKey(parentId)}/${this.sanitizeKey(quoteKey)}`;
      }

    } else if (key.startsWith('replies:quote:') && key.endsWith(':mostRecent')) {
      // Key format: replies:quote:<quoteKeyOrText>:mostRecent
      const parts = key.split(':');
      if (parts.length >= 4 && parts[0] === 'replies' && parts[1] === 'quote' && parts[parts.length - 1] === 'mostRecent') {
        const quoteIdentifier = parts.slice(2, -1).join(':'); // Get everything between replies:quote: and :mostRecent
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
        const parentId = parts[1];
        const quoteText = parts.slice(2, -1).join(':');
        // Index replies by parent and quote text, ordered by timestamp
        return `indexes/repliesByParentTextTimestamp/${this.sanitizeKey(parentId)}/${this.sanitizeKey(quoteText)}`;
      }
    }

    // If no pattern matches, log a warning and return null
    console.warn(`mapZSetKeyToIndexBasePath: No mapping found for key: ${key}`);
    return null;
  }

  sanitizeKey(key: string): string {
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
    try {
      // No special replacements needed here, decodeURIComponent handles %XX codes.
      return decodeURIComponent(input);
    } catch (e) {
      // Handle potential URIError if the input is malformed
      console.error("Failed to decode Firebase key:", input, e);
      return input; // Or throw an error, depending on desired behavior
    }
  }


} 