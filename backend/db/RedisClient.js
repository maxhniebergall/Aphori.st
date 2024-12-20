import { createClient } from 'redis';
import { DatabaseClientInterfaces } from './DatabaseClientInterface.js';

export class RedisClient extends DatabaseClientInterfaces {
  constructor(config) {
    super();
    this.client = createClient(config);
    this.client.on('error', err => console.error('Redis Client Error:', err));
  }

  async connect() {
    await this.client.connect();
  }

  async get(key) {
    return this.client.get(key);
  }

  async set(key, value) {
    return this.client.set(key, value);
  }

  async hGet(key, field) {
    return this.client.hGet(key, field);
  }

  async hSet(key, field, value) {
    return this.client.hSet(key, field, value);
  }

  async lPush(key, value) {
    return this.client.lPush(key, value);
  }

  async lRange(key, start, end) {
    return this.client.lRange(key, start, end);
  }
} 