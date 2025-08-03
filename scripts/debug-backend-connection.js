#!/usr/bin/env node

/**
 * Debug backend Firebase connection details
 */

import admin from 'firebase-admin';

console.log('Backend Firebase connection debug...');

// Check environment variables
console.log('\nEnvironment variables:');
console.log('FIREBASE_DATABASE_EMULATOR_HOST:', process.env.FIREBASE_DATABASE_EMULATOR_HOST);
console.log('GCLOUD_PROJECT:', process.env.GCLOUD_PROJECT);

// Initialize Firebase Admin SDK with emulator settings exactly like backend
const config = {
  databaseURL: 'http://host.docker.internal:9000?ns=aphorist',
  projectId: 'demo-project'
};

console.log('\nInitializing with config:', config);

admin.initializeApp(config);
const db = admin.database();

async function debugConnection() {
  try {
    // Get the actual database URL being used
    console.log('\nConnection details:');
    console.log('Database ref URL:', db.ref().toString());
    
    // Test direct connection to multiple possible namespaces
    const namespaces = ['aphorist', 'demo-project', 'default'];
    
    for (const ns of namespaces) {
      console.log(`\n--- Testing namespace: ${ns} ---`);
      try {
        // Create a new app instance for each namespace
        const testConfig = {
          databaseURL: `http://host.docker.internal:9000?ns=${ns}`,
          projectId: 'demo-project'
        };
        
        const testApp = admin.initializeApp(testConfig, `test-${ns}`);
        const testDb = testApp.database();
        
        const rootSnapshot = await testDb.ref('/').once('value');
        const rootData = rootSnapshot.val();
        const keys = Object.keys(rootData || {});
        
        console.log(`Root keys in ${ns}:`, keys.slice(0, 5), keys.length > 5 ? `... (+${keys.length - 5} more)` : '');
        
        // Check specifically for dailyPuzzles
        const puzzleSnapshot = await testDb.ref('dailyPuzzles').once('value');
        if (puzzleSnapshot.exists()) {
          console.log(`✅ dailyPuzzles found in ${ns}!`);
          const puzzleData = puzzleSnapshot.val();
          if (puzzleData.themes) {
            console.log(`Theme dates: ${Object.keys(puzzleData.themes)}`);
          }
        } else {
          console.log(`❌ No dailyPuzzles in ${ns}`);
        }
        
        await testApp.delete();
      } catch (error) {
        console.log(`Error testing ${ns}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error('Connection debug error:', error);
  }
  
  process.exit(0);
}

debugConnection();