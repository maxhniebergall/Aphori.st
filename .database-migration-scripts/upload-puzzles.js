#!/usr/bin/env node

/**
 * Firebase Puzzle Sets Migration Script
 * 
 * This script safely uploads new puzzle sets to the aphorist-themes Firebase RTDB
 * without overwriting existing data. It merges new puzzles with existing ones.
 * 
 * Note: This script does not create backups. Ensure you have manual backups or
 * automated Firebase backups enabled before running in production.
 * 
 * Usage:
 * - Local (with emulator): FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000 node upload-puzzles.js
 * - Production: FIREBASE_CREDENTIAL="..." THEMES_FIREBASE_DATABASE_URL="..." node upload-puzzles.js
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const PUZZLE_DATA_PATH = join(__dirname, '..', 'scripts', 'puzzle-generation', 'batch-output', 'unified-firebase-puzzles.json');
const DVC_PUZZLE_DATA_PATH = join(__dirname, '..', 'scripts', 'datascience', 'themes_quality', 'puzzle_generation_output', 'gemini-puzzles_firebase.json');
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

// Get current database state for merging
async function getCurrentData(db) {
  log('Loading current puzzle sets from database...');
  
  try {
    const snapshot = await db.ref(FIREBASE_RTDB_PATH).once('value');
    const currentData = snapshot.val() || {};
    
    const setCount = Object.keys(currentData).length;
    log(`Found ${setCount} existing puzzle sets in database`);
    
    return currentData;
  } catch (e) {
    error('Failed to load current data:', e.message);
    throw e;
  }
}

// Ensure DVC data is pulled and available
function ensureDvcDataAvailable() {
  log('Ensuring DVC puzzle data is available...');
  
  try {
    // Navigate to the themes_quality directory and activate venv, then pull DVC data
    const themesQualityDir = join(__dirname, '..', 'scripts', 'datascience', 'themes_quality');
    const dvcCmd = `cd "${themesQualityDir}" && source themes_quality_venv/bin/activate && dvc pull puzzle_generation_output.dvc`;
    
    log(`Running: ${dvcCmd}`);
    execSync(dvcCmd, { 
      stdio: 'inherit',
      shell: '/bin/bash'
    });
    
    log('DVC data pull completed successfully');
  } catch (e) {
    error('Failed to pull DVC data:', e.message);
    throw new Error(`Cannot proceed without DVC puzzle data: ${e.message}`);
  }
}

// Convert dailyPuzzles format to puzzleSets format
function convertDailyPuzzlesToPuzzleSets(dailyPuzzlesData) {
  const puzzleSets = {};
  
  if (dailyPuzzlesData.dailyPuzzles) {
    for (const [setName, dates] of Object.entries(dailyPuzzlesData.dailyPuzzles)) {
      puzzleSets[setName] = {};
      
      for (const [date, gridSizes] of Object.entries(dates)) {
        for (const [gridSize, puzzles] of Object.entries(gridSizes)) {
          if (!puzzleSets[setName][gridSize]) {
            puzzleSets[setName][gridSize] = {};
          }
          
          // Merge puzzles from this date into the grid size
          Object.assign(puzzleSets[setName][gridSize], puzzles);
        }
      }
    }
  }
  
  return puzzleSets;
}

// Load puzzle data from generated file or DVC
function loadPuzzleData() {
  // First try to load from DVC (new format)
  if (existsSync(DVC_PUZZLE_DATA_PATH)) {
    log(`Loading DVC puzzle data from: ${DVC_PUZZLE_DATA_PATH}`);
    
    // Ensure DVC data is up to date
    ensureDvcDataAvailable();
    
    try {
      const data = JSON.parse(readFileSync(DVC_PUZZLE_DATA_PATH, 'utf8'));
      
      let puzzleSets;
      if (data.puzzleSets) {
        // Already in puzzleSets format
        puzzleSets = data.puzzleSets;
      } else if (data.dailyPuzzles) {
        // Convert from dailyPuzzles format
        log('Converting dailyPuzzles format to puzzleSets format...');
        puzzleSets = convertDailyPuzzlesToPuzzleSets(data);
      } else {
        throw new Error('Invalid DVC puzzle data format: missing puzzleSets or dailyPuzzles');
      }

      const setCount = Object.keys(puzzleSets).length;
      let totalPuzzles = 0;
      
      Object.values(puzzleSets).forEach(setData => {
        Object.values(setData).forEach(gridSize => {
          if (typeof gridSize === 'object') {
            totalPuzzles += Object.keys(gridSize).length;
          }
        });
      });

      log(`Loaded ${setCount} puzzle sets with ${totalPuzzles} total puzzles from DVC`);
      return puzzleSets;
    } catch (e) {
      error('Failed to load DVC puzzle data:', e.message);
      error('Falling back to legacy puzzle data file...');
    }
  }
  
  // Fallback to legacy format
  log(`Loading legacy puzzle data from: ${PUZZLE_DATA_PATH}`);
  
  if (!existsSync(PUZZLE_DATA_PATH)) {
    throw new Error(`Neither DVC puzzle data (${DVC_PUZZLE_DATA_PATH}) nor legacy puzzle data (${PUZZLE_DATA_PATH}) found`);
  }

  try {
    const data = JSON.parse(readFileSync(PUZZLE_DATA_PATH, 'utf8'));
    
    if (!data.puzzleSets || typeof data.puzzleSets !== 'object') {
      throw new Error('Invalid legacy puzzle data format: missing puzzleSets');
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

    log(`Loaded ${setCount} puzzle sets with ${totalPuzzles} total puzzles from legacy format`);
    return data.puzzleSets;
  } catch (e) {
    error('Failed to load legacy puzzle data:', e.message);
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
    
    // Load current data
    const currentData = await getCurrentData(db);
    
    // Load new puzzle data
    const newPuzzles = loadPuzzleData();
    
    // Merge with existing data
    log('Merging new puzzles with existing data...');
    const { mergedData, changes } = mergePuzzleSets(currentData, newPuzzles);
    
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