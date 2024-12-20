// Abstract base class for database operations
export class DatabaseClient {
  async get(key) {
    throw new Error('Method not implemented');
  }

  async set(key, value) {
    throw new Error('Method not implemented');
  }

  async hGet(key, field) {
    throw new Error('Method not implemented');
  }

  async hSet(key, field, value) {
    throw new Error('Method not implemented');
  }

  async lPush(key, value) {
    throw new Error('Method not implemented');
  }

  async lRange(key, start, end) {
    throw new Error('Method not implemented');
  }

  async connect() {
    throw new Error('Method not implemented');
  }
} 