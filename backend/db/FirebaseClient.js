import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { DatabaseClient } from './DatabaseClient.js';

export class FirebaseClient extends DatabaseClient {
  constructor(config) {
    super();
    try {
      // Parse the credential string if it's a JSON string
      let credential;
      if (typeof config.credential === 'string') {
        credential = JSON.parse(config.credential);
      } else {
        credential = config.credential;
      }
      
      const app = initializeApp({
        credential: cert(credential),
        databaseURL: config.databaseURL
      });
      this.db = getDatabase(app);
    } catch (error) {
      console.error('Error initializing Firebase:', error);
      throw error;
    }
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
} 