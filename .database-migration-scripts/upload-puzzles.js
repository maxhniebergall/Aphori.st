#!/usr/bin/env node

/**
 * Firebase Puzzle Sets Migration Script v2
 * 
 * This script uploads specific puzzle sets to the aphorist-themes Firebase RTDB
 * with custom naming. It supports uploading multiple versions of the same puzzle set
 * with different names (e.g., gemini_50, gemini_51, gemini_test).
 * 
 * Features:
 * - Requires explicit source file and rename target
 * - Validates name uniqueness before upload
 * - Transforms puzzle IDs and references to match new name
 * - Updates both puzzleSets and setIndex atomically
 * - Supports multiple versions of the same puzzles
 * 
 * Usage:
 * node upload-puzzles.js --source-file <path> --rename-to <unique-name>
 * 
 * Examples:
 * - Upload gemini puzzles as gemini_50:
 *   node upload-puzzles.js --source-file scripts/puzzle-generation/batch-output/gemini_firebase.json --rename-to gemini_50
 * 
 * - Upload another version:
 *   node upload-puzzles.js --source-file scripts/puzzle-generation/batch-output/gemini_firebase.json --rename-to gemini_51
 * 
 * Environment variables:
 * - Local (with emulator): FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000
 * - Production: FIREBASE_CREDENTIAL="..." THEMES_FIREBASE_DATABASE_URL="..."
 * 
 * Note: This script does not create backups. Ensure you have manual backups or
 * automated Firebase backups enabled before running in production.
 */

import { readFileSync, existsSync } from 'fs';
import admin from 'firebase-admin';

// Configuration
const FIREBASE_RTDB_PATH = 'puzzleSets';
const SET_INDEX_PATH = 'setIndex';

// Logging utilities
function log(message, ...args) {
  console.log(`[${new Date().toISOString()}] ${message}`, ...args);
}

function error(message, ...args) {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`, ...args);
}

// Command-line argument parsing
function getArgValue(args, flag) {
  const index = args.indexOf(flag);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

function parseAndValidateArgs() {
  const args = process.argv.slice(2);
  const sourceFile = getArgValue(args, '--source-file');
  const renameTo = getArgValue(args, '--rename-to');
  
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node upload-puzzles.js --source-file <path> --rename-to <unique-name>');
    console.log('');
    console.log('Required arguments:');
    console.log('  --source-file <path>    Path to puzzle data file (e.g., gemini_firebase.json)');
    console.log('  --rename-to <name>      Unique name for the puzzle set (e.g., gemini_50)');
    console.log('');
    console.log('Environment variables:');
    console.log('  FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000  (for local testing)');
    console.log('  FIREBASE_CREDENTIAL="..."                       (for production)');
    console.log('  THEMES_FIREBASE_DATABASE_URL="..."              (for production)');
    process.exit(0);
  }
  
  // Validate required parameters
  if (!sourceFile) {
    error('--source-file is required');
    console.log('Usage: node upload-puzzles.js --source-file <path> --rename-to <unique-name>');
    console.log('Use --help for more information.');
    process.exit(1);
  }
  
  if (!renameTo) {
    error('--rename-to is required');
    console.log('Usage: node upload-puzzles.js --source-file <path> --rename-to <unique-name>');
    console.log('Use --help for more information.');
    process.exit(1);
  }
  
  // Validate source file exists
  if (!existsSync(sourceFile)) {
    error(`Source file not found: ${sourceFile}`);
    process.exit(1);
  }
  
  // Validate rename-to format (basic validation)
  if (!/^[a-zA-Z0-9_-]+$/.test(renameTo)) {
    error(`Invalid name format: ${renameTo}. Only alphanumeric characters, hyphens, and underscores allowed.`);
    process.exit(1);
  }
  
  log(`✓ Arguments validated:`);
  log(`  Source file: ${sourceFile}`);
  log(`  Rename to: ${renameTo}`);
  
  return { sourceFile, renameTo };
}


// Check name uniqueness against database
async function checkNameUniqueness(db, newName) {
  log(`Checking if name '${newName}' is unique...`);
  
  try {
    // Check puzzleSets
    const puzzleSetsSnapshot = await db.ref(`${FIREBASE_RTDB_PATH}/${newName}`).once('value');
    if (puzzleSetsSnapshot.exists()) {
      error(`Puzzle set '${newName}' already exists in database`);
      console.log('Please choose a different name with --rename-to');
      process.exit(1);
    }
    
    // Check setIndex
    const setIndexSnapshot = await db.ref(`${SET_INDEX_PATH}/${newName}`).once('value');
    if (setIndexSnapshot.exists()) {
      error(`Set index for '${newName}' already exists in database`);
      console.log('Please choose a different name with --rename-to');
      process.exit(1);
    }
    
    log(`✓ Name '${newName}' is available`);
  } catch (e) {
    error(`Failed to check name uniqueness: ${e.message}`);
    throw e;
  }
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


// Transform puzzle set with new name and IDs
function transformPuzzleSet(puzzleSet, oldName, newName) {
  log(`Transforming puzzle set from '${oldName}' to '${newName}'...`);
  const transformed = {};
  let puzzleCount = 0;
  
  for (const [gridSize, puzzles] of Object.entries(puzzleSet)) {
    transformed[gridSize] = {};
    
    for (const [oldPuzzleId, puzzle] of Object.entries(puzzles)) {
      // Extract puzzle number from old ID (e.g., gemini_batch_2025-08-27_1 -> 1)
      const puzzleNumber = oldPuzzleId.split('_').pop();
      const newPuzzleId = `${newName}_${puzzleNumber}`;
      
      // Update puzzle object
      const updatedPuzzle = {
        ...puzzle,
        id: newPuzzleId,
        setName: newName,
        // Update category IDs to match new naming
        categories: puzzle.categories.map((cat, idx) => ({
          ...cat,
          id: `${newName}_${puzzleNumber}_cat_${idx}`
        }))
      };
      
      transformed[gridSize][newPuzzleId] = updatedPuzzle;
      puzzleCount++;
    }
  }
  
  log(`✓ Transformed ${puzzleCount} puzzles`);
  return transformed;
}

// Count puzzles in a puzzle set
function countPuzzles(puzzleSet) {
  let count = 0;
  for (const gridSizes of Object.values(puzzleSet)) {
    if (typeof gridSizes === 'object') {
      count += Object.keys(gridSizes).length;
    }
  }
  return count;
}

// Load and transform puzzle data from source file
function loadAndTransformPuzzleData(sourceFile, renameTo) {
  log(`Loading puzzle data from: ${sourceFile}`);
  
  try {
    const data = JSON.parse(readFileSync(sourceFile, 'utf8'));
    
    if (!data.puzzleSets || Object.keys(data.puzzleSets).length === 0) {
      error('No puzzle sets found in source file. File must contain puzzleSets format.');
      process.exit(1);
    }
    
    // Get the puzzle sets from the file
    const originalSetNames = Object.keys(data.puzzleSets);
    
    if (originalSetNames.length === 0) {
      error('Source file contains no puzzle sets');
      process.exit(1);
    }
    
    if (originalSetNames.length > 1) {
      error(`Source file contains multiple puzzle sets: ${originalSetNames.join(', ')}`);
      console.log('This script currently supports only one puzzle set per file.');
      console.log('Please use a file with a single puzzle set.');
      process.exit(1);
    }
    
    const originalSetName = originalSetNames[0];
    const puzzleSet = data.puzzleSets[originalSetName];
    
    log(`Found puzzle set: '${originalSetName}'`);
    
    // Transform all puzzle IDs and references
    const transformedSet = transformPuzzleSet(puzzleSet, originalSetName, renameTo);
    const puzzleCount = countPuzzles(transformedSet);
    
    log(`✓ Loaded and transformed ${puzzleCount} puzzles`);
    
    return {
      puzzleSets: { [renameTo]: transformedSet },
      originalSetName,
      puzzleCount
    };
  } catch (e) {
    error(`Failed to load puzzle data: ${e.message}`);
    process.exit(1);
  }
}

// Extract algorithm from puzzle set by examining the first puzzle's metadata
function extractAlgorithmFromPuzzleSet(puzzleSet) {
  // Look at all grid sizes to find the first puzzle
  for (const [gridSize, puzzles] of Object.entries(puzzleSet)) {
    const puzzleIds = Object.keys(puzzles);
    if (puzzleIds.length > 0) {
      const firstPuzzleId = puzzleIds[0];
      const firstPuzzle = puzzles[firstPuzzleId];
      
      // Check if the puzzle has metadata with algorithm field
      if (firstPuzzle && firstPuzzle.metadata && firstPuzzle.metadata.algorithm) {
        return firstPuzzle.metadata.algorithm;
      }
      
      // If no metadata.algorithm, try to derive from puzzle structure or ID
      // This could be extended with more sophisticated logic if needed
      break;
    }
  }
  
  // Return null if algorithm cannot be determined, caller will use default
  return null;
}

// Create setIndex entry for the new puzzle set
function createSetIndexEntry(puzzleSet, setName, originalSetName, algorithm = "wiki_puzzle_gemini_pipeline") {
  log(`Creating setIndex entry for '${setName}'...`);
  
  const puzzleIds = [];
  const sizeCounts = {};
  let totalCount = 0;
  
  // Collect puzzle IDs and count by grid size
  for (const [gridSize, puzzles] of Object.entries(puzzleSet)) {
    const gridPuzzleIds = Object.keys(puzzles);
    puzzleIds.push(...gridPuzzleIds);
    sizeCounts[gridSize] = gridPuzzleIds.length;
    totalCount += gridPuzzleIds.length;
  }
  
  // Sort puzzle IDs numerically by puzzle number
  puzzleIds.sort((a, b) => {
    const numA = parseInt(a.split('_').pop());
    const numB = parseInt(b.split('_').pop());
    return numA - numB;
  });
  
  const setIndexEntry = {
    algorithm: algorithm,
    availableSizes: Object.keys(sizeCounts).sort(),
    generatorVersion: "3.0.0-custom",
    lastUpdated: Date.now(),
    metadata: {
      batchGenerated: true,
      description: `Custom upload of ${setName}`,
      generatedAt: new Date().toISOString(),
      originalSetName: originalSetName,
      uploadedVia: "migration-script-v2"
    },
    puzzleIds: puzzleIds,
    sizeCounts: sizeCounts,
    status: "active",
    totalCount: totalCount
  };
  
  log(`✓ Created setIndex entry: ${totalCount} puzzles, sizes: ${Object.keys(sizeCounts).join(', ')}`);
  return setIndexEntry;
}


// Upload puzzle set with setIndex atomically
async function uploadPuzzleSet(db, puzzleData, setIndexEntry, setName) {
  log(`Uploading puzzle set '${setName}' to Firebase...`);
  
  try {
    // Use multi-path update for atomic operation
    const updates = {};
    
    // Add puzzle set data
    updates[`${FIREBASE_RTDB_PATH}/${setName}`] = puzzleData.puzzleSets[setName];
    
    // Add setIndex entry
    updates[`${SET_INDEX_PATH}/${setName}`] = setIndexEntry;
    
    // Perform atomic update
    await db.ref().update(updates);
    
    log(`✓ Successfully uploaded ${puzzleData.puzzleCount} puzzles as '${setName}'`);
    log(`✓ Created setIndex entry for '${setName}'`);
    return true;
  } catch (e) {
    error(`Failed to upload puzzle set: ${e.message}`);
    throw e;
  }
}

// Verify the upload was successful
async function verifyPuzzleSetUpload(db, puzzleData, setIndexEntry, setName) {
  log(`Verifying upload of '${setName}'...`);
  
  try {
    // Check puzzleSets data
    const puzzleSnapshot = await db.ref(`${FIREBASE_RTDB_PATH}/${setName}`).once('value');
    if (!puzzleSnapshot.exists()) {
      throw new Error(`Verification failed: Puzzle set '${setName}' not found in database`);
    }
    
    // Check setIndex data
    const indexSnapshot = await db.ref(`${SET_INDEX_PATH}/${setName}`).once('value');
    if (!indexSnapshot.exists()) {
      throw new Error(`Verification failed: Set index for '${setName}' not found in database`);
    }
    
    // Verify puzzle count matches
    const uploadedPuzzleSet = puzzleSnapshot.val();
    let uploadedCount = 0;
    for (const gridSizes of Object.values(uploadedPuzzleSet)) {
      if (typeof gridSizes === 'object') {
        uploadedCount += Object.keys(gridSizes).length;
      }
    }
    
    if (uploadedCount !== puzzleData.puzzleCount) {
      throw new Error(`Verification failed: Expected ${puzzleData.puzzleCount} puzzles, found ${uploadedCount}`);
    }
    
    // Verify setIndex puzzle count matches
    const uploadedIndex = indexSnapshot.val();
    if (uploadedIndex.totalCount !== puzzleData.puzzleCount) {
      throw new Error(`Verification failed: setIndex totalCount mismatch`);
    }
    
    log(`✓ Verification passed: ${uploadedCount} puzzles uploaded correctly`);
    return true;
  } catch (e) {
    error(`Verification failed: ${e.message}`);
    throw e;
  }
}


// Main execution
async function main() {
  try {
    log('Starting selective puzzle upload...');
    
    // Parse and validate command-line arguments
    const { sourceFile, renameTo } = parseAndValidateArgs();
    
    // Initialize Firebase
    const db = initializeFirebase();
    
    // Check name uniqueness
    await checkNameUniqueness(db, renameTo);
    
    // Load and transform puzzle data
    const puzzleData = loadAndTransformPuzzleData(sourceFile, renameTo);
    
    // Extract algorithm from puzzle set or use default
    const algorithm = extractAlgorithmFromPuzzleSet(puzzleData.puzzleSets[renameTo]) || "wiki_puzzle_gemini_pipeline";
    
    // Create setIndex entry
    const setIndexEntry = createSetIndexEntry(
      puzzleData.puzzleSets[renameTo], 
      renameTo, 
      puzzleData.originalSetName,
      algorithm
    );
    
    // Upload puzzle set and setIndex atomically
    await uploadPuzzleSet(db, puzzleData, setIndexEntry, renameTo);
    
    // Verify upload
    await verifyPuzzleSetUpload(db, puzzleData, setIndexEntry, renameTo);
    
    log(`🎯 Successfully uploaded puzzle set '${renameTo}' with ${puzzleData.puzzleCount} puzzles`);
    log('Upload completed successfully!');
    
  } catch (e) {
    error('Upload failed:', e.message);
    if (e.stack) {
      error('Stack trace:', e.stack);
    }
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}