#!/usr/bin/env node

/**
 * Firebase Puzzle Sets Rename Migration Script
 * 
 * This script renames existing puzzle sets in the aphorist-themes Firebase RTDB.
 * It handles both the puzzleSets data and setIndex entries atomically.
 * 
 * Renaming mappings:
 * - Gemini_batch_2025-08-20 → WikiNews10_Gemini10
 * - Wiki_batch_2025-08-20 → WikiNews10
 * - Gemini_50 → WikiNews50_Gemini50
 * 
 * Features:
 * - Validates source puzzle sets exist before migration
 * - Transforms puzzle IDs and references to match new names
 * - Updates both puzzleSets and setIndex atomically
 * - Supports dry-run mode for safety
 * - Verifies migration success before cleanup
 * - Deletes old data after successful migration
 * 
 * Usage:
 * node rename-puzzle-sets.js [--dry-run]
 * 
 * Examples:
 * - Dry run (preview changes): node rename-puzzle-sets.js --dry-run
 * - Execute migration: node rename-puzzle-sets.js
 * 
 * Environment variables:
 * - Local (with emulator): FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000
 * - Production: FIREBASE_CREDENTIAL="..." THEMES_FIREBASE_DATABASE_URL="..."
 */

import admin from 'firebase-admin';

// Configuration
const FIREBASE_RTDB_PATH = 'puzzleSets';
const SET_INDEX_PATH = 'setIndex';

// Renaming mappings
const RENAME_MAPPINGS = {
  'gemini_batch_2025-08-20': 'WikiNews10_Gemini10',
  'wiki_batch_2025-08-20': 'WikiNews10',
  'gemini_50': 'WikiNews50_Gemini50'
};

// Logging utilities
function log(message, ...args) {
  console.log(`[${new Date().toISOString()}] ${message}`, ...args);
}

function error(message, ...args) {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`, ...args);
}

function warn(message, ...args) {
  console.warn(`[${new Date().toISOString()}] WARN: ${message}`, ...args);
}

// Command-line argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node rename-puzzle-sets.js [--dry-run]');
    console.log('');
    console.log('Options:');
    console.log('  --dry-run              Preview changes without executing migration');
    console.log('  --help, -h             Show this help message');
    console.log('');
    console.log('Renaming mappings:');
    for (const [oldName, newName] of Object.entries(RENAME_MAPPINGS)) {
      console.log(`  ${oldName} → ${newName}`);
    }
    console.log('');
    console.log('Environment variables:');
    console.log('  FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000  (for local testing)');
    console.log('  FIREBASE_CREDENTIAL="..."                       (for production)');
    console.log('  THEMES_FIREBASE_DATABASE_URL="..."              (for production)');
    process.exit(0);
  }
  
  return { isDryRun };
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

// Check which puzzle sets exist and need to be renamed
async function validateSourcePuzzleSets(db) {
  log('Validating source puzzle sets...');
  
  const existingSets = {};
  const missingSets = [];
  
  for (const oldName of Object.keys(RENAME_MAPPINGS)) {
    try {
      // Check if puzzleSet exists
      const puzzleSnapshot = await db.ref(`${FIREBASE_RTDB_PATH}/${oldName}`).once('value');
      const indexSnapshot = await db.ref(`${SET_INDEX_PATH}/${oldName}`).once('value');
      
      if (puzzleSnapshot.exists()) {
        existingSets[oldName] = {
          puzzleData: puzzleSnapshot.val(),
          indexData: indexSnapshot.exists() ? indexSnapshot.val() : null
        };
        log(`✓ Found puzzle set: ${oldName}`);
      } else {
        missingSets.push(oldName);
        warn(`✗ Missing puzzle set: ${oldName}`);
      }
    } catch (e) {
      error(`Failed to check puzzle set ${oldName}: ${e.message}`);
      throw e;
    }
  }
  
  if (missingSets.length > 0) {
    log(`Missing puzzle sets: ${missingSets.join(', ')}`);
    log('Migration will only process existing sets.');
  }
  
  return existingSets;
}

// Check if target names already exist
async function validateTargetNames(db, existingSets) {
  log('Validating target names...');
  
  const conflicts = [];
  
  for (const [oldName, _] of Object.entries(existingSets)) {
    const newName = RENAME_MAPPINGS[oldName];
    
    try {
      const puzzleSnapshot = await db.ref(`${FIREBASE_RTDB_PATH}/${newName}`).once('value');
      const indexSnapshot = await db.ref(`${SET_INDEX_PATH}/${newName}`).once('value');
      
      if (puzzleSnapshot.exists() || indexSnapshot.exists()) {
        conflicts.push(newName);
        error(`✗ Target name already exists: ${newName}`);
      } else {
        log(`✓ Target name available: ${newName}`);
      }
    } catch (e) {
      error(`Failed to check target name ${newName}: ${e.message}`);
      throw e;
    }
  }
  
  if (conflicts.length > 0) {
    throw new Error(`Cannot proceed: Target names already exist: ${conflicts.join(', ')}`);
  }
}

// Transform puzzle set with new name and IDs
function transformPuzzleSet(puzzleSet, oldName, newName) {
  log(`Transforming puzzle set from '${oldName}' to '${newName}'...`);
  const transformed = {};
  let puzzleCount = 0;
  
  for (const [gridSize, puzzles] of Object.entries(puzzleSet)) {
    if (!puzzles || typeof puzzles !== 'object') continue;
    
    transformed[gridSize] = {};
    
    for (const [oldPuzzleId, puzzle] of Object.entries(puzzles)) {
      if (!puzzle || typeof puzzle !== 'object') continue;
      
      // Extract puzzle number from old ID
      // Handle different formats like: oldName_1, oldName_batch_date_1, etc.
      const parts = oldPuzzleId.split('_');
      const puzzleNumber = parts[parts.length - 1];
      const newPuzzleId = `${newName}_${puzzleNumber}`;
      
      // Update puzzle object
      const updatedPuzzle = {
        ...puzzle,
        id: newPuzzleId,
        setName: newName
      };
      
      // Update category IDs if they exist
      if (puzzle.categories && Array.isArray(puzzle.categories)) {
        updatedPuzzle.categories = puzzle.categories.map((cat, idx) => ({
          ...cat,
          id: `${newName}_${puzzleNumber}_cat_${idx}`
        }));
      }
      
      transformed[gridSize][newPuzzleId] = updatedPuzzle;
      puzzleCount++;
    }
  }
  
  log(`✓ Transformed ${puzzleCount} puzzles`);
  return transformed;
}

// Update setIndex entry with new name
function updateSetIndexEntry(indexData, oldName, newName, puzzleSet) {
  if (!indexData) {
    // Create a basic setIndex entry if one doesn't exist
    const puzzleIds = [];
    const sizeCounts = {};
    let totalCount = 0;
    
    for (const [gridSize, puzzles] of Object.entries(puzzleSet)) {
      if (puzzles && typeof puzzles === 'object') {
        const gridPuzzleIds = Object.keys(puzzles);
        puzzleIds.push(...gridPuzzleIds);
        sizeCounts[gridSize] = gridPuzzleIds.length;
        totalCount += gridPuzzleIds.length;
      }
    }
    
    // Sort puzzle IDs numerically by puzzle number
    puzzleIds.sort((a, b) => {
      const numA = parseInt(a.split('_').pop());
      const numB = parseInt(b.split('_').pop());
      return numA - numB;
    });
    
    return {
      algorithm: "migration_renamed",
      availableSizes: Object.keys(sizeCounts).sort(),
      generatorVersion: "migration-v1",
      lastUpdated: Date.now(),
      metadata: {
        migratedFrom: oldName,
        migratedAt: new Date().toISOString(),
        migratedVia: "rename-puzzle-sets-script"
      },
      puzzleIds: puzzleIds,
      sizeCounts: sizeCounts,
      status: "active",
      totalCount: totalCount
    };
  }
  
  // Update existing setIndex entry
  const updatedIndex = { ...indexData };
  
  // Update puzzle IDs to match new naming
  if (updatedIndex.puzzleIds) {
    updatedIndex.puzzleIds = updatedIndex.puzzleIds.map(oldId => {
      const parts = oldId.split('_');
      const puzzleNumber = parts[parts.length - 1];
      return `${newName}_${puzzleNumber}`;
    });
  }
  
  // Update metadata
  updatedIndex.lastUpdated = Date.now();
  updatedIndex.metadata = {
    ...updatedIndex.metadata,
    migratedFrom: oldName,
    migratedAt: new Date().toISOString(),
    migratedVia: "rename-puzzle-sets-script"
  };
  
  return updatedIndex;
}

// Perform the migration (dry run or actual)
async function performMigration(db, existingSets, isDryRun) {
  const migrations = [];
  
  log(isDryRun ? 'Preparing migration (dry run)...' : 'Performing migration...');
  
  // Prepare all transformations
  for (const [oldName, data] of Object.entries(existingSets)) {
    const newName = RENAME_MAPPINGS[oldName];
    
    // Transform puzzle set
    const transformedPuzzleSet = transformPuzzleSet(data.puzzleData, oldName, newName);
    
    // Update setIndex entry
    const updatedIndexEntry = updateSetIndexEntry(data.indexData, oldName, newName, transformedPuzzleSet);
    
    migrations.push({
      oldName,
      newName,
      transformedPuzzleSet,
      updatedIndexEntry,
      originalData: data
    });
    
    log(`${isDryRun ? 'Would migrate' : 'Migrating'}: ${oldName} → ${newName}`);
    
    if (isDryRun) {
      // Show preview of changes
      const puzzleCount = Object.values(transformedPuzzleSet)
        .reduce((sum, gridData) => sum + (typeof gridData === 'object' ? Object.keys(gridData).length : 0), 0);
      log(`  - ${puzzleCount} puzzles would be transformed`);
      log(`  - setIndex entry would be ${data.indexData ? 'updated' : 'created'}`);
    }
  }
  
  if (isDryRun) {
    log('Dry run complete. Use without --dry-run to execute migration.');
    return migrations;
  }
  
  // Execute actual migration
  try {
    // Prepare atomic update
    const updates = {};
    
    for (const migration of migrations) {
      // Add new puzzle set data
      updates[`${FIREBASE_RTDB_PATH}/${migration.newName}`] = migration.transformedPuzzleSet;
      
      // Add new setIndex entry
      updates[`${SET_INDEX_PATH}/${migration.newName}`] = migration.updatedIndexEntry;
    }
    
    // Perform atomic update
    log('Executing atomic update...');
    await db.ref().update(updates);
    log('✓ Migration data written successfully');
    
    return migrations;
  } catch (e) {
    error(`Migration failed: ${e.message}`);
    throw e;
  }
}

// Verify migration success
async function verifyMigration(db, migrations) {
  log('Verifying migration...');
  
  for (const migration of migrations) {
    try {
      // Check new puzzle set exists
      const puzzleSnapshot = await db.ref(`${FIREBASE_RTDB_PATH}/${migration.newName}`).once('value');
      if (!puzzleSnapshot.exists()) {
        throw new Error(`Verification failed: New puzzle set '${migration.newName}' not found`);
      }
      
      // Check new setIndex exists
      const indexSnapshot = await db.ref(`${SET_INDEX_PATH}/${migration.newName}`).once('value');
      if (!indexSnapshot.exists()) {
        throw new Error(`Verification failed: New setIndex '${migration.newName}' not found`);
      }
      
      // Verify puzzle count
      const newPuzzleData = puzzleSnapshot.val();
      let newCount = 0;
      for (const gridData of Object.values(newPuzzleData)) {
        if (typeof gridData === 'object') {
          newCount += Object.keys(gridData).length;
        }
      }
      
      let originalCount = 0;
      for (const gridData of Object.values(migration.originalData.puzzleData)) {
        if (typeof gridData === 'object') {
          originalCount += Object.keys(gridData).length;
        }
      }
      
      if (newCount !== originalCount) {
        throw new Error(`Verification failed: Puzzle count mismatch for ${migration.newName}. Expected ${originalCount}, got ${newCount}`);
      }
      
      log(`✓ Verified migration: ${migration.newName} (${newCount} puzzles)`);
    } catch (e) {
      error(`Verification failed for ${migration.newName}: ${e.message}`);
      throw e;
    }
  }
}

// Clean up old data after successful migration
async function cleanupOldData(db, migrations) {
  log('Cleaning up old data...');
  
  try {
    const cleanupUpdates = {};
    
    for (const migration of migrations) {
      // Mark old entries for deletion
      cleanupUpdates[`${FIREBASE_RTDB_PATH}/${migration.oldName}`] = null;
      cleanupUpdates[`${SET_INDEX_PATH}/${migration.oldName}`] = null;
      
      log(`Removing old data: ${migration.oldName}`);
    }
    
    // Execute cleanup
    await db.ref().update(cleanupUpdates);
    log('✓ Cleanup completed successfully');
  } catch (e) {
    error(`Cleanup failed: ${e.message}`);
    throw e;
  }
}

// Main execution
async function main() {
  try {
    log('Starting puzzle set rename migration...');
    
    // Parse command-line arguments
    const { isDryRun } = parseArgs();
    
    if (isDryRun) {
      log('Running in DRY RUN mode - no changes will be made');
    }
    
    // Show renaming mappings
    log('Renaming mappings:');
    for (const [oldName, newName] of Object.entries(RENAME_MAPPINGS)) {
      log(`  ${oldName} → ${newName}`);
    }
    
    // Initialize Firebase
    const db = initializeFirebase();
    
    // Validate source puzzle sets exist
    const existingSets = await validateSourcePuzzleSets(db);
    
    if (Object.keys(existingSets).length === 0) {
      warn('No source puzzle sets found. Nothing to migrate.');
      process.exit(0);
    }
    
    // Validate target names are available
    await validateTargetNames(db, existingSets);
    
    // Perform migration
    const migrations = await performMigration(db, existingSets, isDryRun);
    
    if (isDryRun) {
      log('🔍 Dry run completed successfully!');
      process.exit(0);
    }
    
    // Verify migration success
    await verifyMigration(db, migrations);
    
    // Clean up old data
    await cleanupOldData(db, migrations);
    
    log(`🎯 Successfully renamed ${migrations.length} puzzle sets!`);
    log('Migration completed successfully!');
    process.exit(0);
    
  } catch (e) {
    error('Migration failed:', e.message);
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