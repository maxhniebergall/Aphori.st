#!/usr/bin/env node

/**
 * Firebase Puzzle Sets Migration Script
 * 
 * This script safely uploads new puzzle sets to the aphorist-themes Firebase RTDB
 * without overwriting existing data. It merges new puzzles with existing ones.
 * 
 * Usage:
 * - Local (with emulator): FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000 node upload-puzzles.js
 * - Production: FIREBASE_CREDENTIAL="..." THEMES_FIREBASE_DATABASE_URL="..." node upload-puzzles.js
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const PUZZLE_DATA_PATH = join(__dirname, '..', 'scripts', 'puzzle-generation', 'batch-output', 'unified-firebase-puzzles.json');
const BACKUP_DIR = join(__dirname, 'backups');
const FIREBASE_RTDB_PATH = 'puzzleSets';

// Logging utilities
function log(message, ...args) {
  console.log(`[${new Date().toISOString()}] ${message}`, ...args);
}

function error(message, ...args) {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`, ...args);
}

// Initialize Firebase Admin
function initializeFirebase() {
  let appOptions = {};
  let namespace = 'aphorist-themes';

  // Check if running against the emulator
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    log('Connecting to Firebase emulator');
    const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    appOptions.databaseURL = `http://${emulatorHost}?ns=${namespace}`;
    
    // Initialize without credentials for emulator
    try {
      admin.initializeApp(appOptions);
    } catch (e) {
      if (e.code !== 'app/duplicate-app') {
        throw e;
      }
      log('Firebase app already initialized');
    }
  } else {
    // Production mode
    log('Connecting to production Firebase');
    
    if (!process.env.FIREBASE_CREDENTIAL) {
      throw new Error('FIREBASE_CREDENTIAL environment variable is required for production');
    }

    try {
      const credential = JSON.parse(process.env.FIREBASE_CREDENTIAL);
      appOptions.credential = admin.credential.cert(credential);
      appOptions.databaseURL = process.env.THEMES_FIREBASE_DATABASE_URL || 
        'https://aphorist-themes-default-rtdb.firebaseio.com/?ns=aphorist-themes';
      
      log(`Using Firebase URL: ${appOptions.databaseURL}`);
      admin.initializeApp(appOptions);
    } catch (e) {
      throw new Error(`Failed to parse FIREBASE_CREDENTIAL: ${e.message}`);
    }
  }

  return admin.database();
}

// Create backup directory if it doesn't exist
function ensureBackupDirectory() {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// Create backup of current database state
async function createBackup(db) {
  log('Creating backup of current puzzle sets...');
  
  try {
    const snapshot = await db.ref(FIREBASE_RTDB_PATH).once('value');
    const currentData = snapshot.val() || {};
    
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    const backupFileName = `puzzleSets-backup-${timestamp}.json`;
    const backupPath = join(BACKUP_DIR, backupFileName);
    
    ensureBackupDirectory();
    writeFileSync(backupPath, JSON.stringify(currentData, null, 2));
    
    log(`Backup created: ${backupPath}`);
    return {
      path: backupPath,
      data: currentData
    };
  } catch (e) {
    error('Failed to create backup:', e.message);
    throw e;
  }
}

// Load puzzle data from generated file
function loadPuzzleData() {
  log(`Loading puzzle data from: ${PUZZLE_DATA_PATH}`);
  
  if (!existsSync(PUZZLE_DATA_PATH)) {
    throw new Error(`Puzzle data file not found: ${PUZZLE_DATA_PATH}`);
  }

  try {
    const data = JSON.parse(readFileSync(PUZZLE_DATA_PATH, 'utf8'));
    
    if (!data.puzzleSets || typeof data.puzzleSets !== 'object') {
      throw new Error('Invalid puzzle data format: missing puzzleSets');
    }

    const setCount = Object.keys(data.puzzleSets).length;
    let totalPuzzles = 0;
    
    Object.values(data.puzzleSets).forEach(setData => {
      Object.values(setData).forEach(gridSize => {
        if (typeof gridSize === 'object') {
          totalPuzzles += Object.keys(gridSize).length;
        }
      });
    });

    log(`Loaded ${setCount} puzzle sets with ${totalPuzzles} total puzzles`);
    return data.puzzleSets;
  } catch (e) {
    error('Failed to load puzzle data:', e.message);
    throw e;
  }
}

// Merge new puzzles with existing ones
function mergePuzzleSets(existing, newPuzzles) {
  const mergedData = { ...existing };
  const changes = {
    newSets: [],
    updatedSets: [],
    newPuzzles: 0
  };

  for (const [setName, setData] of Object.entries(newPuzzles)) {
    if (!mergedData[setName]) {
      // New set - add entirely
      mergedData[setName] = setData;
      changes.newSets.push(setName);
      
      // Count puzzles in new set
      Object.values(setData).forEach(gridSize => {
        if (typeof gridSize === 'object') {
          changes.newPuzzles += Object.keys(gridSize).length;
        }
      });
    } else {
      // Existing set - merge grid sizes and puzzles
      const existingSet = mergedData[setName];
      let setPuzzlesAdded = 0;
      
      for (const [gridSize, puzzles] of Object.entries(setData)) {
        if (!existingSet[gridSize]) {
          // New grid size for this set
          existingSet[gridSize] = puzzles;
          setPuzzlesAdded += Object.keys(puzzles).length;
        } else {
          // Merge puzzles within this grid size
          const existingPuzzles = existingSet[gridSize];
          
          for (const [puzzleId, puzzleData] of Object.entries(puzzles)) {
            if (!existingPuzzles[puzzleId]) {
              existingPuzzles[puzzleId] = puzzleData;
              setPuzzlesAdded++;
            } else {
              log(`Skipping existing puzzle: ${puzzleId} in ${setName}/${gridSize}`);
            }
          }
        }
      }
      
      if (setPuzzlesAdded > 0) {
        changes.updatedSets.push(setName);
        changes.newPuzzles += setPuzzlesAdded;
      }
    }
  }

  return { mergedData, changes };
}

// Upload merged data to Firebase using transaction
async function uploadMergedData(db, mergedData, changes) {
  log('Starting Firebase upload...');
  
  try {
    await db.ref(FIREBASE_RTDB_PATH).transaction((currentData) => {
      // Double-check merge in transaction to handle concurrent updates
      if (currentData === null) {
        currentData = {};
      }
      
      // Re-merge with current state in case of concurrent changes
      const finalMerge = mergePuzzleSets(currentData, mergedData);
      return finalMerge.mergedData;
    });
    
    log('Upload completed successfully');
    log(`Summary: ${changes.newSets.length} new sets, ${changes.updatedSets.length} updated sets, ${changes.newPuzzles} new puzzles added`);
    
    if (changes.newSets.length > 0) {
      log('New sets:', changes.newSets);
    }
    if (changes.updatedSets.length > 0) {
      log('Updated sets:', changes.updatedSets);
    }
    
    return true;
  } catch (e) {
    error('Failed to upload to Firebase:', e.message);
    throw e;
  }
}

// Verify the upload was successful
async function verifyUpload(db, originalData) {
  log('Verifying upload...');
  
  try {
    const snapshot = await db.ref(FIREBASE_RTDB_PATH).once('value');
    const currentData = snapshot.val() || {};
    
    // Check that all new sets and puzzles are present
    for (const [setName, setData] of Object.entries(originalData)) {
      if (!currentData[setName]) {
        throw new Error(`Verification failed: Set ${setName} not found in database`);
      }
      
      for (const [gridSize, puzzles] of Object.entries(setData)) {
        if (!currentData[setName][gridSize]) {
          throw new Error(`Verification failed: Grid size ${gridSize} not found in set ${setName}`);
        }
        
        for (const puzzleId of Object.keys(puzzles)) {
          if (!currentData[setName][gridSize][puzzleId]) {
            throw new Error(`Verification failed: Puzzle ${puzzleId} not found in ${setName}/${gridSize}`);
          }
        }
      }
    }
    
    log('Verification passed - all data successfully uploaded');
    return true;
  } catch (e) {
    error('Verification failed:', e.message);
    throw e;
  }
}

// Main execution
async function main() {
  try {
    log('Starting puzzle migration...');
    
    // Initialize Firebase
    const db = initializeFirebase();
    
    // Create backup
    const backup = await createBackup(db);
    
    // Load new puzzle data
    const newPuzzles = loadPuzzleData();
    
    // Merge with existing data
    log('Merging new puzzles with existing data...');
    const { mergedData, changes } = mergePuzzleSets(backup.data, newPuzzles);
    
    if (changes.newPuzzles === 0) {
      log('No new puzzles to add - migration complete');
      return;
    }
    
    // Upload merged data
    await uploadMergedData(db, mergedData, changes);
    
    // Verify upload
    await verifyUpload(db, newPuzzles);
    
    log('Puzzle migration completed successfully');
    
  } catch (e) {
    error('Migration failed:', e.message);
    error('Stack trace:', e.stack);
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}