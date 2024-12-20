import { createDatabaseClient } from '../db/index.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function getSecret(secretName) {
  try {
    const { stdout } = await execAsync(`gcloud secrets versions access latest --secret="${secretName}"`);
    return stdout.trim();
  } catch (error) {
    console.error(`Failed to get secret ${secretName}:`, error);
    throw error;
  }
}

async function main() {
  try {
    // Set production environment
    process.env.NODE_ENV = 'production';
    
    // Get Firebase credentials from Secret Manager
    process.env.FIREBASE_CREDENTIAL = await getSecret('firebase-admin-key');
    process.env.FIREBASE_DATABASE_URL = await getSecret('firebase-database-url');
    
    // Initialize database client
    const db = createDatabaseClient();
    await db.connect();
    
    // Test write
    const testKey = 'test-key';
    const testValue = { timestamp: Date.now(), message: 'Test write' };
    await db.set(testKey, JSON.stringify(testValue));
    console.log('Write successful');
    
    // Test read
    const readValue = await db.get(testKey);
    console.log('Read value:', readValue);
    
    // Test hash operations
    await db.hSet('test-hash', 'field1', 'value1');
    const hashValue = await db.hGet('test-hash', 'field1');
    console.log('Hash operations successful:', hashValue);
    
    // Test list operations
    await db.lPush('test-list', 'item1');
    const listItems = await db.lRange('test-list', 0, -1);
    console.log('List operations successful:', listItems);
    
    console.log('All tests passed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main(); 