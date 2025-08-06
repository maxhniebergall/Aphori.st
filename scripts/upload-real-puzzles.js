#!/usr/bin/env node

/**
 * Upload real puzzle data via backend Firebase SDK
 */

import admin from 'firebase-admin';
import fs from 'fs';

// Initialize exactly like the backend does
admin.initializeApp({
  databaseURL: 'http://host.docker.internal:9000?ns=aphorist',
  projectId: 'demo-project'
});

const db = admin.database();

async function uploadRealPuzzles() {
  console.log('Loading real puzzle data...');
  
  try {
    // Read the nested puzzle data file
    const puzzleData = JSON.parse(fs.readFileSync('/app/scripts/puzzle-generation/test-single-file/firebase_import_nested.json', 'utf8'));
    
    console.log('Uploading dailyPuzzles...');
    await db.ref('dailyPuzzles').set(puzzleData.dailyPuzzles);
    console.log('✅ dailyPuzzles uploaded');
    
    console.log('Uploading puzzleIndex...');
    await db.ref('puzzleIndex').set(puzzleData.puzzleIndex);
    console.log('✅ puzzleIndex uploaded');
    
    // Verify the uploads
    const dailySnapshot = await db.ref('dailyPuzzles/themes').once('value');
    if (dailySnapshot.exists()) {
      const dailyData = dailySnapshot.val();
      console.log('✅ Verification: Daily puzzles found for dates:', Object.keys(dailyData));
      
      // Check 2025-08-02 specifically
      const aug2Snapshot = await db.ref('dailyPuzzles/themes/2025-08-02').once('value');
      if (aug2Snapshot.exists()) {
        const aug2Data = aug2Snapshot.val();
        console.log('✅ August 2nd puzzles:', Object.keys(aug2Data));
      }
    }
    
    const indexSnapshot = await db.ref('puzzleIndex/themes').once('value');
    if (indexSnapshot.exists()) {
      const indexData = indexSnapshot.val();
      console.log('✅ Verification: Puzzle index found for dates:', Object.keys(indexData));
    }
    
    console.log('✅ All puzzle data uploaded successfully!');
    
  } catch (error) {
    console.error('Upload error:', error);
  }
  
  process.exit(0);
}

uploadRealPuzzles();