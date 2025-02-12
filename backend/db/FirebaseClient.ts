import { initializeApp, App } from 'firebase-admin/app';
import { getDatabase, Database, ServerValue } from 'firebase-admin/database';
import { cert } from 'firebase-admin/app';
import { DatabaseClientInterface } from './DatabaseClientInterface.js';

interface FirebaseConfig {
  credential: any;
  databaseURL: string;
}

export class FirebaseClient extends DatabaseClientInterface {
  private db: Database;

  constructor(config: FirebaseConfig) {
    super();
    const app = initializeApp({
      credential: cert(config.credential),
      databaseURL: config.databaseURL
    });
    this.db = getDatabase(app);
  }

  async connect(): Promise<void> {
    // Firebase connects automatically
    return Promise.resolve();
  }

  async get(key: string): Promise<any> {
    const snapshot = await this.db.ref(key).once('value');
    return snapshot.val();
  }

  async set(key: string, value: any): Promise<string | null> {
    await this.db.ref(key).set(value);
    return 'OK';
  }

  async hGet(key: string, field: string): Promise<any> {
    const snapshot = await this.db.ref(`${key}/${field}`).once('value');
    return snapshot.val();
  }

  async hSet(key: string, field: string, value: any): Promise<number> {
    await this.db.ref(`${key}/${field}`).set(value);
    return 1;
  }

  async lPush(key: string, value: any): Promise<number> {
    const ref = this.db.ref(key);
    const snapshot = await ref.once('value');
    const currentList = snapshot.val() || [];
    currentList.unshift(value);
    await ref.set(currentList);
    return currentList.length;
  }

  async lRange(key: string, start: number, end: number): Promise<any[]> {
    const snapshot = await this.db.ref(key).once('value');
    const list = snapshot.val() || [];
    return list.slice(start, end + 1);
  }

  async sAdd(key: string, value: any): Promise<number> {
    const ref = this.db.ref(key);
    const snapshot = await ref.once('value');
    const currentSet = snapshot.val() || {};
    
    // In Firebase, we'll implement sets as objects with values as keys
    // This ensures uniqueness and O(1) lookups
    if (!currentSet[value]) {
      currentSet[value] = true;
      await ref.set(currentSet);
      return 1; // Return 1 if we added a new value
    }
    return 0; // Return 0 if value was already in set
  }

  async sMembers(key: string): Promise<string[]> {
    const snapshot = await this.db.ref(key).once('value');
    const currentSet = snapshot.val() || {};
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
    const snapshot = await this.db.ref(key).once('value');
    return snapshot.val();
  }

  async zAdd(key: string, score: number, value: any): Promise<number> {
    const ref = this.db.ref(key);
    const snapshot = await ref.once('value');
    const currentData = snapshot.val() || {};
    
    // Store data with score as key for ordering
    currentData[score] = {
      score: score,
      value: value
    };
    
    await ref.set(currentData);
    return 1;
  }

  async zCard(key: string): Promise<number> {
    const snapshot = await this.db.ref(key)
      .orderByChild('score')
      .once('value');
    return snapshot.numChildren() || 0;
  }

  async zRange(key: string, start: number, end: number): Promise<any[]> {
    const snapshot = await this.db.ref(key)
      .orderByChild('score')
      .once('value');
    
    const results: any[] = [];
    snapshot.forEach((childSnapshot) => {
      results.push(childSnapshot.val().value);
    });
    
    return results.slice(start, end + 1);
  }

  async del(key: string): Promise<number> {
    await this.db.ref(key).remove();
    return 1; // Return 1 to match Redis behavior
  }

  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    const ref = this.db.ref(`${key}/${field}`);
    const update: Record<string, any> = {};
    update[field] = ServerValue.increment(increment);
    await ref.update(update);
    
    // Get the new value after increment
    const snapshot = await ref.once('value');
    return snapshot.val();
  }

  async zRevRangeByScore(key: string, max: number, min: number, options?: { limit?: number }): Promise<any[]> {
    // Query the database using orderByChild on 'score'
    const snapshot = await this.db.ref(key)
      .orderByChild('score')
      .startAt(min)
      .endAt(max)
      .once('value');

    const results: any[] = [];
    snapshot.forEach((childSnapshot) => {
      results.push(childSnapshot.val());
    });

    // Reverse the results to simulate descending order
    results.reverse();

    // Apply limit if provided
    if (options?.limit) {
      return results.slice(0, options.limit);
    }
    return results;
  }
} 