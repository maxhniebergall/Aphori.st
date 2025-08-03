#!/usr/bin/env node

/**
 * Debug backend database access
 */

import admin from 'firebase-admin';

// Initialize Firebase Admin SDK with emulator settings exactly like backend
admin.initializeApp({
  databaseURL: 'http://host.docker.internal:9000?ns=aphorist',
  projectId: 'demo-project'
});

const db = admin.database();

async function debugDatabaseAccess() {
  console.log('Debugging backend database access...');
  
  try {
    // Test 1: Check root structure
    console.log('\n1. Root structure:');
    const rootSnapshot = await db.ref('/').once('value');
    const rootData = rootSnapshot.val();
    console.log('Root keys:', Object.keys(rootData || {}));
    
    // Test 2: Check if dailyPuzzles exists
    console.log('\n2. Check dailyPuzzles:');
    const dailyPuzzlesSnapshot = await db.ref('dailyPuzzles').once('value');
    if (dailyPuzzlesSnapshot.exists()) {
      const dailyPuzzlesData = dailyPuzzlesSnapshot.val();
      console.log('✅ dailyPuzzles found');
      console.log('dailyPuzzles keys:', Object.keys(dailyPuzzlesData));
      
      if (dailyPuzzlesData.themes) {
        console.log('themes keys:', Object.keys(dailyPuzzlesData.themes));
        
        // Test 3: Check specific date
        console.log('\n3. Check 2025-08-02:');
        const dateSnapshot = await db.ref('dailyPuzzles/themes/2025-08-02').once('value');
        if (dateSnapshot.exists()) {
          const dateData = dateSnapshot.val();
          console.log('✅ 2025-08-02 puzzles found');
          console.log('Puzzle IDs:', Object.keys(dateData));
        } else {
          console.log('❌ 2025-08-02 puzzles not found');
        }
      }
    } else {
      console.log('❌ dailyPuzzles not found');
    }
    
    // Test 4: Check if we're in the right database
    console.log('\n4. Database connection test:');
    const testRef = db.ref('test-connection');
    await testRef.set({ timestamp: Date.now(), test: 'backend-debug' });
    const testSnapshot = await testRef.once('value');
    console.log('Test write/read:', testSnapshot.val());
    await testRef.remove();
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

debugDatabaseAccess();