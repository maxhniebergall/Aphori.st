import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { DatabaseClientInterfaces } from './DatabaseClientInterface.js';

export class FirebaseClient extends DatabaseClientInterfaces {
  constructor(config) {
    super();
    const app = initializeApp(config);
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
} 