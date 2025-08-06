#!/usr/bin/env node

/**
 * Upload puzzle data via backend Firebase SDK
 */

import admin from 'firebase-admin';

// Initialize exactly like the backend does
admin.initializeApp({
  databaseURL: 'http://host.docker.internal:9000?ns=aphorist',
  projectId: 'demo-project'
});

const db = admin.database();

// Sample puzzle data for testing
const testPuzzleData = {
  "themes_2025-08-02_1": {
    "id": "themes_2025-08-02_1",
    "date": "2025-08-02",
    "puzzleNumber": 1,
    "gridSize": 4,
    "difficulty": 3,
    "words": ["test", "word", "data", "here", "more", "words", "for", "testing", "puzzle", "game", "theme", "connection", "debug", "upload", "backend", "sdk"],
    "categories": [
      {
        "id": "cat_test_1",
        "themeWord": "TEST_THEME",
        "words": ["test", "word", "data", "here"],
        "difficulty": 1,
        "similarity": 0.8
      },
      {
        "id": "cat_test_2", 
        "themeWord": "WORD_THEME",
        "words": ["more", "words", "for", "testing"],
        "difficulty": 2,
        "similarity": 0.7
      },
      {
        "id": "cat_test_3",
        "themeWord": "GAME_THEME", 
        "words": ["puzzle", "game", "theme", "connection"],
        "difficulty": 3,
        "similarity": 0.6
      },
      {
        "id": "cat_test_4",
        "themeWord": "DEBUG_THEME",
        "words": ["debug", "upload", "backend", "sdk"],
        "difficulty": 4,
        "similarity": 0.5
      }
    ],
    "createdAt": Date.now(),
    "metadata": {
      "generatedBy": "backend_upload_test",
      "version": "1.0.0"
    }
  }
};

async function uploadViaBackend() {
  console.log('Uploading puzzle data via backend Firebase SDK...');
  
  try {
    // Upload to the path the backend expects
    const dailyPath = 'dailyPuzzles/themes/2025-08-02';
    console.log(`Uploading to path: ${dailyPath}`);
    
    await db.ref(dailyPath).set(testPuzzleData);
    console.log('✅ Upload successful');
    
    // Verify the upload
    const snapshot = await db.ref(dailyPath).once('value');
    if (snapshot.exists()) {
      const data = snapshot.val();
      console.log('✅ Verification successful - data found');
      console.log('Puzzle IDs:', Object.keys(data));
    } else {
      console.log('❌ Verification failed - no data found');
    }
    
    // Check if it appears in root keys now
    const rootSnapshot = await db.ref('/').once('value');
    const rootData = rootSnapshot.val();
    const rootKeys = Object.keys(rootData || {});
    console.log('Root keys now include dailyPuzzles:', rootKeys.includes('dailyPuzzles'));
    
  } catch (error) {
    console.error('Upload error:', error);
  }
  
  process.exit(0);
}

uploadViaBackend();