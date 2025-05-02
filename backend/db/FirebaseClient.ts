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
   * Hashes a string using SHA-256 for use as a Firebase Realtime Database key/path segment.
   * Hashing ensures the key is within the length limit (SHA-256 hex is 64 chars)
   * and avoids forbidden characters (., #, $, [, ], /).
   * Firebase keys cannot be empty; this function hashes even empty strings.
   */
  private sanitizeFirebaseKey(key: string): string {
      // Create a SHA-256 hash of the input key
      const hash = crypto.createHash('sha256');
      hash.update(key);
      // Return the hash as a hexadecimal string
      return hash.digest('hex');
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

      // Optional: Add a timeout to prevent hanging indefinitely if the emulator/DB is down
      const timeoutId = setTimeout(() => {
          console.error('Firebase Realtime Database connection check timed out.');
          connectedRef.off('value', listener);
          reject(new Error('Connection check timed out'));
      }, 15000); // 15 second timeout

      // Clear timeout if connection succeeds or fails before timeout
      const clearConnectionTimeout = () => clearTimeout(timeoutId);
      connectedRef.on('value', (snap) => { if (snap.val() === true) clearConnectionTimeout(); });
      // Also clear timeout on error
      // The reject path already clears the listener, let's ensure timeout is cleared too.
      // Modify the error handler slightly:
      // }, (error) => { ... reject(error); clearConnectionTimeout(); }); // Can't modify inline easily, do this manually if needed.
      // Simpler: Just wrap resolve/reject to clear timeout
      const originalResolve = resolve;
      const originalReject = reject;
      resolve = () => { clearTimeout(timeoutId); originalResolve(); };
      reject = (err) => { clearTimeout(timeoutId); originalReject(err); };


    });
  }

  async get(key: string): Promise<any> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const snapshot = await this.db.ref(sanitizedKey).once('value');
    return snapshot.val();
  }

  async set(key: string, value: any): Promise<string | null> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    await this.db.ref(sanitizedKey).set(value);
    return 'OK';
  }

  async hGet(key: string, field: string): Promise<any> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const sanitizedField = this.sanitizeFirebaseKey(field);
    const snapshot = await this.db.ref(`${sanitizedKey}/${sanitizedField}`).once('value');
    return snapshot.val();
  }

  async hSet(key: string, field: string, value: any): Promise<number> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const sanitizedField = this.sanitizeFirebaseKey(field);
    await this.db.ref(`${sanitizedKey}/${sanitizedField}`).set(value);
    return 1;
  }

  async lPush(key: string, value: any): Promise<number> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const ref = this.db.ref(sanitizedKey);
    const snapshot = await ref.once('value');
    const currentList = snapshot.val() || [];
    currentList.unshift(value);
    await ref.set(currentList);
    return currentList.length;
  }

  // Deprecate lRange for feed items; use getFeedItemsPage instead.
  // async lRange(key: string, start: number, end: number): Promise<any[]> {
  //   const sanitizedKey = this.sanitizeFirebaseKey(key);
  //   const snapshot = await this.db.ref(sanitizedKey).once('value');
  //   const list = snapshot.val() || [];
  //   return list.slice(start, end + 1);
  // }

  /**
   * Fetches a page of feed items using key-based cursors.
   * @param limit The maximum number of items to return.
   * @param cursorKey The key of the item to start after (exclusive).
   * @returns An object containing the list of items (newest first) and the key for the next older cursor.
   */
  async getFeedItemsPage(limit: number, cursorKey?: string): Promise<{ items: any[], nextCursorKey: string | null }> {
    const feedItemsRef = this.db.ref('feedItems');
    let query = feedItemsRef.orderByKey();

    // If cursorKey is provided, end querying before that key to get older items
    if (cursorKey) {
      query = query.endBefore(cursorKey);
    }

    // Query limit + 1 items from the end (newest) to determine if there's a next older page
    query = query.limitToLast(limit + 1);

    const snapshot = await query.once('value');
    const itemsData = snapshot.val() || {};
    
    const fetchedItems: Array<{ key: string, data: any }> = [];
    // Data from limitToLast comes in ascending key order, process it
    snapshot.forEach((childSnapshot) => {
        fetchedItems.push({ key: childSnapshot.key as string, data: childSnapshot.val() });
    });

    let nextCursorKey: string | null = null;
    let itemsForPage: any[] = [];

    if (fetchedItems.length > limit) {
        // The first item (oldest in this batch) is the cursor for the next older page
        nextCursorKey = fetchedItems[0].key;
        // The items for the current page are the rest (excluding the oldest one)
        itemsForPage = fetchedItems.slice(1).map(item => ({ ...item.data, _key: item.key }));
    } else {
        // Less than limit items fetched, no older page
        nextCursorKey = null;
        itemsForPage = fetchedItems.map(item => ({ ...item.data, _key: item.key }));
    }

    // Reverse the items for the current page to be newest first
    itemsForPage.reverse();

    return { items: itemsForPage, nextCursorKey };
  }

  /**
   * Retrieves the total number of feed items by reading the dedicated counter.
   * @returns The total count of feed items.
   */
  async lLen(key: string): Promise<number> {
    // Ensure the key is the expected feed items key, though we ignore it for the counter path
    if (key !== 'feedItems') {
      console.warn(`lLen called with unexpected key: ${key}. Reading feedStats counter anyway.`);
    }
    // Read the counter value directly
    const counterRef = this.db.ref('feedStats/itemCount');
    const snapshot = await counterRef.once('value');
    return snapshot.val() || 0;
    // const sanitizedKey = this.sanitizeFirebaseKey(key);
    // const snapshot = await this.db.ref(sanitizedKey).once('value');
    // const list = snapshot.val() || [];
    // return list.length;
  }

  async sAdd(key: string, value: any): Promise<number> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const ref = this.db.ref(sanitizedKey);
    const snapshot = await ref.once('value');
    const currentSet = snapshot.val() || {};
    
    // Sanitize value only if it's a string, as it's used as an object key
    const internalKey = typeof value === 'string' ? this.sanitizeFirebaseKey(value) : value;

    // In Firebase, we'll implement sets as objects with sanitized values as keys
    if (!currentSet[internalKey]) {
      currentSet[internalKey] = true; // Store true, or maybe the original value? Let's store true for now.
      await ref.set(currentSet);
      return 1; // Return 1 if we added a new value
    }
    return 0; // Return 0 if value was already in set
  }

  async sMembers(key: string): Promise<string[]> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const snapshot = await this.db.ref(sanitizedKey).once('value');
    const currentSet = snapshot.val() || {};
    // Return the sanitized keys used internally
    return Object.keys(currentSet);
    // Note: If we need to return the *original* values, we'd have to store them,
    // e.g., currentSet[sanitizedValue] = originalValue; and return Object.values(currentSet);
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
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const snapshot = await this.db.ref(sanitizedKey).once('value');
    return snapshot.val();
  }

  async zAdd(key: string, score: number, value: any): Promise<number> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const ref = this.db.ref(sanitizedKey);
    const snapshot = await ref.once('value');
    const currentData = snapshot.val() || {};
    
    // Store data with score as key for ordering. Score (number) is safe.
    currentData[score] = {
      score: score,
      value: value // Store original value
    };
    
    await ref.set(currentData);
    return 1;
  }

  async zCard(key: string): Promise<number> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const snapshot = await this.db.ref(sanitizedKey)
      .orderByChild('score')
      .once('value');
    return snapshot.numChildren() || 0;
  }

  async zRange(key: string, start: number, end: number): Promise<any[]> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const snapshot = await this.db.ref(sanitizedKey)
      .orderByChild('score')
      .once('value');
    
    const results: any[] = [];
    snapshot.forEach((childSnapshot) => {
      results.push(childSnapshot.val().value); // Return original value
    });
    
    return results.slice(start, end + 1);
  }

  async del(key: string): Promise<number> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    await this.db.ref(sanitizedKey).remove();
    return 1; // Return 1 to match Redis behavior
  }

  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const sanitizedField = this.sanitizeFirebaseKey(field);
    const ref = this.db.ref(`${sanitizedKey}/${sanitizedField}`);
    // Firebase Realtime DB transactions are better for atomic increments
    const transactionResult = await ref.transaction((currentValue) => {
        return (currentValue || 0) + increment;
    });

    if (transactionResult.committed && transactionResult.snapshot.exists()) {
        return transactionResult.snapshot.val();
    } else {
        // Handle potential transaction failure or abortion
        console.error(`Transaction for incrementing ${sanitizedKey}/${sanitizedField} failed or was aborted.`);
        // Attempt to fetch the value again as a fallback, though it might not be atomic
        const snapshot = await ref.once('value');
        return snapshot.val() || 0; // Return 0 if it still doesn't exist after failed transaction
    }
  }

  async zRevRangeByScore(key: string, max: number, min: number, options?: { limit?: number }): Promise<Array<{ score: number, value: any }>> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    let query = this.db.ref(sanitizedKey).orderByKey(); // Order by key (which is the score)

    // Firebase key ordering is lexicographical, so stringify scores for range queries
    const minStr = String(min);
    const maxStr = String(max);

    query = query.startAt(minStr).endAt(maxStr);

    // Apply limit using limitToLast for reverse order
    if (options?.limit) {
      query = query.limitToLast(options.limit);
    }

    const snapshot = await query.once('value');
    const results: Array<{ score: number, value: any }> = [];
    
    // Snapshot is already limited and ordered (desc by key due to limitToLast implicitly reversing)
    // Iterate directly
    snapshot.forEach((childSnapshot) => {
      // The value stored under the score key is { score, value }
      results.push(childSnapshot.val()); // This already pushes { score, value }
    });

    // Results from limitToLast are in ascending order of keys (scores) within the limited set.
    // We need descending order (reverse chronological).
    results.reverse();

    return results;
    
    // Old implementation:
    // const snapshot = await this.db.ref(sanitizedKey)
    //   .orderByChild('score')
    //   .startAt(min)
    //   .endAt(max)
    //   .once('value');
    // const results: any[] = [];
    // snapshot.forEach((childSnapshot) => {
    //   results.push(childSnapshot.val()); // Contains {score, value}
    // });
    // results.reverse();
    // if (options?.limit) {
    //   return results.slice(0, options.limit);
    // }
    // return results;
  }

  // Simulate Redis ZSCAN using Firebase queries
  async zscan(key: string, cursor: string, options?: { match?: string; count?: number }): Promise<{ cursor: string | null; items: RedisSortedSetItem<string>[] }> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const count = options?.count || 10; // Default count
    // The 'cursor' here will represent the score to start *after*.
    const startAfterScore = cursor && cursor !== '0' ? Number(cursor) : null;

    let query = this.db.ref(sanitizedKey).orderByChild('score');

    // If cursor exists, start after that score
    if (startAfterScore !== null) {
      query = query.startAfter(startAfterScore);
    }

    // Limit the results to count + 1 to check if there are more items
    query = query.limitToFirst(count + 1);

    const snapshot = await query.once('value');
    const items: RedisSortedSetItem<string>[] = [];
    snapshot.forEach((childSnapshot) => {
      const data = childSnapshot.val();
      // Ensure data has the expected structure { score: number, value: string }
      if (data && typeof data.score === 'number' && typeof data.value === 'string') {
          items.push({ score: data.score, value: data.value }); // Push original value
      } else {
          console.warn(`Invalid data structure in sorted set ${sanitizedKey}:`, data);
      }
    });

    let nextCursor: string | null = null;
    if (items.length > count) {
      const lastItem = items.pop(); // Remove the extra item
      if (lastItem) {
        nextCursor = lastItem.score.toString(); 
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
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const sanitizedField = this.sanitizeFirebaseKey(field); // Sanitize field (quoteKey) too
    const ref = this.db.ref(`${sanitizedKey}/${sanitizedField}`);
    
    // Run transaction
    const transactionResult = await ref.transaction((currentData) => {
      if (currentData === null) {
        // If no data exists, create new entry
        return { quote: quoteValue, count: 1 };
      } else {
        // If data exists, increment count
        // Ensure 'quote' field exists, otherwise initialize
        if (!currentData.quote) {
            currentData.quote = quoteValue;
        }
        currentData.count = (currentData.count || 0) + 1;
        return currentData; // Return the modified data
      }
    });

    // Check if transaction was successful and return the new count
    if (transactionResult.committed && transactionResult.snapshot.exists()) {
      const finalData = transactionResult.snapshot.val();
      return finalData.count;
    } else {
      // Handle potential transaction failure or abortion
      console.error(`Transaction for ${sanitizedKey}/${sanitizedField} failed or was aborted.`);
      // Handled: Propagated to callers (server.ts routes, seed.ts) which catch and handle.
      throw new Error(`Failed to update quote count for ${sanitizedKey}/${sanitizedField}`);
    }
  }

  /**
   * Adds a feed item using Firebase push() to generate a unique, sortable key.
   * @param item The FeedItem object to add.
   * @returns The unique key generated by Firebase for the new item.
   */
  async addFeedItem(item: any): Promise<string> {
    // We won't sanitize the 'feedItems' key itself, assuming it's a fixed path.
    const feedItemsRef = this.db.ref('feedItems');
    const newItemRef = await feedItemsRef.push(item);
    if (!newItemRef.key) {
      // Should theoretically never happen with push()
      throw new Error('Failed to get push key for new feed item.');
    }
    return newItemRef.key;
  }

  /**
   * Atomically increments or decrements the feed item counter.
   * @param amount The amount to increment by (can be negative for decrement).
   */
  async incrementFeedCounter(amount: number): Promise<void> {
    // We won't sanitize the 'feedStats/itemCount' key itself.
    const counterRef = this.db.ref('feedStats/itemCount');
    const transactionResult = await counterRef.transaction((currentValue) => {
      return (currentValue || 0) + amount;
    });

    if (!transactionResult.committed) {
      console.error('Transaction for incrementing feed counter failed or was aborted.');
      // Decide on error handling: throw, retry, or log?
      // Throwing for now, as failure might indicate a larger issue.
      throw new Error('Failed to update feed item counter.');
    }
    // No return value needed for void
  }
} 