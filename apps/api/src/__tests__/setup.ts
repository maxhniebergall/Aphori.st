import { beforeAll, afterAll, beforeEach } from 'vitest';
import { testDb } from './utils/testDb.js';

// Initialize and teardown test database
beforeAll(async () => {
  console.log('🗂️  Setting up test database...');
  await testDb.setup();
  console.log('✓ Test database ready');
});

afterAll(async () => {
  console.log('🧹 Tearing down test database...');
  await testDb.teardown();
  console.log('✓ Test database cleaned up');
});

// Reset database state between tests
beforeEach(async () => {
  await testDb.reset();
});

// Make testDb globally accessible
declare global {
  var testDb: typeof import('./utils/testDb.js').testDb;
}

globalThis.testDb = testDb;
