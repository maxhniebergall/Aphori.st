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

  /**
   * Hashes a string using SHA-256 for use as a dynamic Firebase Realtime Database key/path segment.
   * Ensures the segment avoids forbidden characters and length limits.
   * Firebase keys cannot be empty; this function hashes even empty strings.
   */
  private hashFirebaseKey(key: string): string {
    const hash = crypto.createHash('sha256');
    hash.update(key);
    return hash.digest('hex');
  }

  /**
   * Escapes characters forbidden in Firebase keys (`.` `#` `$` `[` `]`).
   * Uses a custom mapping for readability.
   */
  private _escapeFirebaseKey(key: string): string {
    // Replace forbidden characters with custom sequences
    return key
      .replace(/\./g, ',,') // Replace dots with double commas
      .replace(/#/g, '-sharp-')
      .replace(/\$/g, '-dollar-')
      .replace(/\[/g, '-obracket-')
      .replace(/]/g, '-cbracket-');
    // Add replacements for other potentially problematic chars if needed
  }

  /**
   * Unescapes characters previously escaped by _escapeFirebaseKey.
   */
  private _unescapeFirebaseKey(escapedKey: string): string {
    // Reverse the replacements
    return escapedKey
      .replace(/-cbracket-/g, ']')
      .replace(/-obracket-/g, '[')
      .replace(/-dollar-/g, '$')
      .replace(/-sharp-/g, '#')
      .replace(/,,/g, '.'); // Replace double commas back to dots
  }

  async connect(): Promise<void> {
    // Firebase connects automatically, but we need to verify the connection
    // before declaring the client ready, especially for the emulator.
    return new Promise((resolve, reject) => {
      const connectedRef = this.db.ref('.info/connected');

      const listener = connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
          console.log('Firebase Realtime Database connection verified.');
          connectedRef.off('value', listener); // Remove listener once connected
          resolve();
        } else {
          console.log('Waiting for Firebase Realtime Database connection...');
        }
      }, (error) => {
        console.error('Firebase Realtime Database connection check failed:', error);
        connectedRef.off('value', listener); // Remove listener on error
        reject(error);
      });

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
    // Dynamic key is hashed
    const hashedKey = this.hashFirebaseKey(key);
    const snapshot = await this.db.ref(hashedKey).once('value');
    return snapshot.val();
  }

  async set(key: string, value: any): Promise<string | null> {
    // Dynamic key is hashed
    const hashedKey = this.hashFirebaseKey(key);
    await this.db.ref(hashedKey).set(value);
    return 'OK';
  }

  async hGet(key: string, field: string): Promise<any> {
    // Dynamic key and field are hashed
    const hashedKey = this.hashFirebaseKey(key);
    const hashedField = this.hashFirebaseKey(field);
    const snapshot = await this.db.ref(`${hashedKey}/${hashedField}`).once('value');
    return snapshot.val();
  }

  async hSet(key: string, field: string, value: any): Promise<number> {
    // Dynamic key and field are hashed
    const hashedKey = this.hashFirebaseKey(key);
    const hashedField = this.hashFirebaseKey(field);
    await this.db.ref(`${hashedKey}/${hashedField}`).set(value);
    return 1;
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
    const path = (key === 'feedItems') ? key : this.hashFirebaseKey(key);
    const ref = this.db.ref(path);
    try {
      let dataToPush = value;
      if (typeof value === 'string') {
        try {
          dataToPush = JSON.parse(value);
        } catch (e) {
          // Explicitly log the parsing error
          console.error(`FirebaseClient lPush: Failed to parse JSON string for path ${path}. Pushing raw string. Error:`, e, 'Raw value:', value);
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
    // Hash the main key
    const hashedKey = this.hashFirebaseKey(key);
    const ref = this.db.ref(hashedKey);

    // Escape the value to use as the child key for the set member
    const escapedValue = this._escapeFirebaseKey(String(value)); // Ensure value is string

    // Check if the escaped value already exists as a key
    const snapshot = await ref.child(escapedValue).once('value');

    if (!snapshot.exists()) {
      // If it doesn't exist, add it with a value of true
      await ref.child(escapedValue).set(true);
      return 1; // Indicate an item was added
    }
    return 0; // Indicate the item already existed
  }

  async sMembers(key: string): Promise<string[]> {
    // Hash the main key
    const hashedKey = this.hashFirebaseKey(key);
    const snapshot = await this.db.ref(hashedKey).once('value');
    const currentSet = snapshot.val() || {};
    // Get the escaped keys
    const escapedKeys = Object.keys(currentSet);
    // Unescape each key to return the original values
    return escapedKeys.map(escapedKey => this._unescapeFirebaseKey(escapedKey));
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
    // Hash the dynamic key
    const hashedKey = this.hashFirebaseKey(key);
    const snapshot = await this.db.ref(hashedKey).once('value');
    return snapshot.val();
  }

  async zAdd(key: string, score: number, value: any): Promise<number> {
    // Hash the main key
    const hashedKey = this.hashFirebaseKey(key);
    // Use score directly as child key, store { score, value } object
    const ref = this.db.ref(`${hashedKey}/${score}`);
    await ref.set({ score: score, value: value });
    return 1;
  }

  async zCard(key: string): Promise<number> {
    // Hash the main key
    const hashedKey = this.hashFirebaseKey(key);
    const snapshot = await this.db.ref(hashedKey).once('value');
    // Count children (each child key is a score)
    return snapshot.numChildren();
  }

  async zRange(key: string, start: number, end: number): Promise<any[]> {
    // Hash the main key
    const hashedKey = this.hashFirebaseKey(key);
    // Order by key (score) and limit to get the range
    const query = this.db.ref(hashedKey).orderByKey().limitToFirst(end + 1); // Fetch enough to slice
    const snapshot = await query.once('value');

    const results: any[] = [];
    snapshot.forEach((childSnapshot) => {
      // Key is the score, value is { score, value }
      results.push(childSnapshot.val().value); // Extract original value
    });

    // Apply the start index slice
    return results.slice(start);
  }

  async del(key: string): Promise<number> {
    // Hash the dynamic key
    const hashedKey = this.hashFirebaseKey(key);
    await this.db.ref(hashedKey).remove();
    return 1;
  }

  /**
   * Atomically increments a numeric value stored at a path constructed from key and field.
   * Hashes key and field before constructing the path.
   * @returns The new value after incrementing.
   */
  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    // Always hash dynamic key and field
    const hashedKey = this.hashFirebaseKey(key);
    const hashedField = this.hashFirebaseKey(field);
    const refPath = `${hashedKey}/${hashedField}`;
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
    // Hash the main key
    const hashedKey = this.hashFirebaseKey(key);
    // Order by key (score) 
    let query = this.db.ref(hashedKey).orderByKey();

    // Use string representation for range queries on numeric keys
    const minStr = String(min);
    const maxStr = String(max);
    query = query.startAt(minStr).endAt(maxStr);

    // Apply limit if provided
    if (options?.limit) {
      // Cannot directly limit with start/end AND get correct reverse order easily.
      // Fetch all in range, then sort/limit in code.
      // For large ranges, this is inefficient. Consider alternative structure if performance critical.
    }

    const snapshot = await query.once('value');
    const results: Array<{ score: number, value: any }> = [];
    snapshot.forEach((childSnapshot) => {
      results.push(childSnapshot.val()); // Value is { score, value }
    });

    // Sort descending by score and apply limit
    results.sort((a, b) => b.score - a.score);
    if (options?.limit) {
      return results.slice(0, options.limit);
    }
    return results;
  }

  // Simulate Redis ZSCAN using Firebase queries
  async zscan(key: string, cursor: string, options?: { match?: string; count?: number }): Promise<{ cursor: string | null; items: RedisSortedSetItem<string>[] }> {
    // Hash the main key
    const hashedKey = this.hashFirebaseKey(key);
    const count = options?.count || 10;
    // Cursor is the score (as string key) to start after
    const startAfterKey = cursor && cursor !== '0' ? cursor : null;

    let query = this.db.ref(hashedKey).orderByKey(); // Order by score (key)

    if (startAfterKey) {
      query = query.startAfter(startAfterKey);
    }

    query = query.limitToFirst(count + 1);

    const snapshot = await query.once('value');
    const items: RedisSortedSetItem<string>[] = [];
    snapshot.forEach((childSnapshot) => {
      const data = childSnapshot.val();
      // Value is { score, value }
      if (data && typeof data.score === 'number' && typeof data.value !== 'undefined') {
        // Convert value to string for RedisSortedSetItem compatibility if needed, or adjust type
        items.push({ score: data.score, value: String(data.value) });
      } else {
        console.warn(`Invalid data structure in sorted set ${hashedKey}:`, data);
      }
    });

    let nextCursor: string | null = null;
    if (items.length > count) {
      const lastItem = items.pop(); // Remove extra item
      if (lastItem) {
        nextCursor = String(lastItem.score); // Next cursor is the score of the last item fetched
      }
    }

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
    // Hash dynamic key and field
    const hashedKey = this.hashFirebaseKey(key);
    const hashedField = this.hashFirebaseKey(field);
    const refPath = `${hashedKey}/${hashedField}`;
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
   * Adds a feed item to the fixed 'feedItems' path using push().
   * @param item The FeedItem object.
   * @returns The unique key generated by Firebase.
   */
  async addFeedItem(item: any): Promise<string> {
    // Use the fixed, unhashed path 'feedItems'
    const feedItemsRef = this.db.ref('feedItems');
    const newItemRef = await feedItemsRef.push(item);
    if (!newItemRef.key) throw new Error('Failed to get push key for new feed item.');
    return newItemRef.key;
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
} 