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

  async lRange(key: string, start: number, end: number): Promise<any[]> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const snapshot = await this.db.ref(sanitizedKey).once('value');
    const list = snapshot.val() || [];
    return list.slice(start, end + 1);
  }

  async lLen(key: string): Promise<number> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    const snapshot = await this.db.ref(sanitizedKey).once('value');
    const list = snapshot.val() || [];
    return list.length;
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

  async zRevRangeByScore(key: string, max: number, min: number, options?: { limit?: number }): Promise<any[]> {
    const sanitizedKey = this.sanitizeFirebaseKey(key);
    // Query the database using orderByChild on 'score'
    const snapshot = await this.db.ref(sanitizedKey)
      .orderByChild('score')
      .startAt(min)
      .endAt(max)
      .once('value');

    const results: any[] = [];
    snapshot.forEach((childSnapshot) => {
      results.push(childSnapshot.val()); // Contains {score, value}
    });

    // Reverse the results to simulate descending order
    results.reverse();

    // Apply limit if provided
    if (options?.limit) {
      return results.slice(0, options.limit);
    }
    return results;
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
      throw new Error(`Failed to update quote count for ${sanitizedKey}/${sanitizedField}`);
    }
  }
} 