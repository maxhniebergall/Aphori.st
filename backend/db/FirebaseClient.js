import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { cert } from 'firebase-admin/app';
import { DatabaseClientInterface } from './DatabaseClientInterface.js';

export class FirebaseClient extends DatabaseClientInterface {
  constructor(config) {
    super();
    const app = initializeApp({
      credential: cert(config.credential),
      databaseURL: config.databaseURL
    });
    this.db = getDatabase(app);
  }

  async connect() {
    // Firebase connects automatically
    return Promise.resolve();
  }

  async get(key) {
    const snapshot = await this.db.ref(key).once('value');
    return snapshot.val();
  }

  async set(key, value) {
    await this.db.ref(key).set(value);
    return 'OK';
  }

  async hGet(key, field) {
    const snapshot = await this.db.ref(`${key}/${field}`).once('value');
    return snapshot.val();
  }

  async hSet(key, field, value) {
    await this.db.ref(`${key}/${field}`).set(value);
    return 1;
  }

  async lPush(key, value) {
    const ref = this.db.ref(key);
    const snapshot = await ref.once('value');
    const currentList = snapshot.val() || [];
    currentList.unshift(value);
    await ref.set(currentList);
    return currentList.length;
  }

  async lRange(key, start, end) {
    const snapshot = await this.db.ref(key).once('value');
    const list = snapshot.val() || [];
    return list.slice(start, end + 1);
  }

  async sAdd(key, value) {
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

  async sMembers(key) {
    const snapshot = await this.db.ref(key).once('value');
    const currentSet = snapshot.val() || {};
    return Object.keys(currentSet);
  }
} 