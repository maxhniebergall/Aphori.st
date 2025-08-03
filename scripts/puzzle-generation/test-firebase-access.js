#!/usr/bin/env node

/**
 * Test Firebase access to puzzle data
 */

import admin from 'firebase-admin';

// Initialize Firebase Admin SDK with emulator settings
admin.initializeApp({
  databaseURL: 'http://localhost:9000?ns=aphorist',
  projectId: 'demo-project'
});

const db = admin.database();

async function testAccess() {
  console.log('Testing Firebase access to puzzle data...');
  
  try {
    // Test 1: Direct path access
    console.log('\n1. Testing direct path access...');
    const directRef = db.ref('dailyPuzzles/themes/2025-08-02');
    const directSnapshot = await directRef.once('value');
    
    if (directSnapshot.exists()) {
      const data = directSnapshot.val();
      console.log('✅ Direct access successful!');
      console.log('Puzzle IDs found:', Object.keys(data));
    } else {
      console.log('❌ Direct access failed - no data found');
    }
    
    // Test 2: Nested path access
    console.log('\n2. Testing nested path access...');
    const nestedRef = db.ref('dailyPuzzles').child('themes').child('2025-08-02');
    const nestedSnapshot = await nestedRef.once('value');
    
    if (nestedSnapshot.exists()) {
      const data = nestedSnapshot.val();
      console.log('✅ Nested access successful!');
      console.log('Puzzle IDs found:', Object.keys(data));
    } else {
      console.log('❌ Nested access failed - no data found');
    }
    
    // Test 3: Root check
    console.log('\n3. Testing root structure...');
    const rootRef = db.ref('/');
    const rootSnapshot = await rootRef.once('value');
    const rootData = rootSnapshot.val();
    
    console.log('Root keys:', Object.keys(rootData || {}));
    if (rootData && rootData.dailyPuzzles) {
      console.log('✅ dailyPuzzles found in root');
      console.log('Themes keys:', Object.keys(rootData.dailyPuzzles.themes || {}));
    } else {
      console.log('❌ dailyPuzzles not found in root');
    }
    
  } catch (error) {
    console.error('Error testing Firebase access:', error);
  } finally {
    process.exit(0);
  }
}

testAccess();