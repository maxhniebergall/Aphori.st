#!/usr/bin/env node

/**
 * Test backend puzzle data access
 */

import admin from 'firebase-admin';

// Initialize Firebase Admin SDK with emulator settings
admin.initializeApp({
  databaseURL: 'http://host.docker.internal:9000?ns=aphorist',
  projectId: 'demo-project'
});

const db = admin.database();

async function testPuzzleAccess() {
  console.log('Testing puzzle data access from backend...');
  
  try {
    // Test direct access to August 2nd puzzles
    const path = 'dailyPuzzles/themes/2025-08-02';
    console.log(`Checking path: ${path}`);
    
    const snapshot = await db.ref(path).once('value');
    if (snapshot.exists()) {
      const data = snapshot.val();
      console.log('✅ Puzzle data found!');
      console.log('Puzzle IDs:', Object.keys(data));
      
      // Check first puzzle structure
      const firstPuzzleKey = Object.keys(data)[0];
      const firstPuzzle = data[firstPuzzleKey];
      console.log(`First puzzle (${firstPuzzleKey}):`, {
        id: firstPuzzle.id,
        date: firstPuzzle.date,
        puzzleNumber: firstPuzzle.puzzleNumber,
        wordCount: firstPuzzle.words?.length,
        categoryCount: firstPuzzle.categories?.length
      });
    } else {
      console.log('❌ No puzzle data found');
      
      // Check what's at the root
      const rootSnapshot = await db.ref('/').once('value');
      const rootData = rootSnapshot.val();
      console.log('Root keys:', Object.keys(rootData || {}));
      
      if (rootData?.dailyPuzzles) {
        console.log('dailyPuzzles keys:', Object.keys(rootData.dailyPuzzles));
        if (rootData.dailyPuzzles.themes) {
          console.log('themes keys:', Object.keys(rootData.dailyPuzzles.themes));
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

testPuzzleAccess();