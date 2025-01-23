/* requirements
- Implements abstract methods for database operations
- Adds isConnected, isReady, encodeKey, hGetAll, zCard, and zRange methods to the DatabaseClientInterface
- Adds zAdd method for ordered set operations
- Adds del method for key deletion
*/
// Abstract base class for database operations
export class DatabaseClientInterface {
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

  async sAdd(key, value) {
    throw new Error('Method not implemented');
  }

  async sMembers(key) {
    throw new Error('Method not implemented');
  }

  async connect() {
    throw new Error('Method not implemented');
  }

  async isConnected() {
    throw new Error('Method not implemented');
  }

  async isReady() {
    throw new Error('Method not implemented');
  }

  encodeKey(key, prefix) {
    throw new Error('Method not implemented');
  }

  async hGetAll(key) {
    throw new Error('Method not implemented');
  }

  async zCard(key) {
    throw new Error('Method not implemented');
  }

  async zRange(key, start, end) {
    throw new Error('Method not implemented');
  }

  async zAdd(key, score, value) {
    throw new Error('Method not implemented');
  }

  async del(key) {
    throw new Error('Method not implemented');
  }
} 