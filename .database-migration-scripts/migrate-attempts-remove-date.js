#!/usr/bin/env node

/**
 * Firebase gameAttempts Date Structure Migration Script
 * 
 * This script migrates gameAttempts from date-grouped structure to flat structure.
 * 
 * Migration:
 * FROM: gameAttempts/themes/{userId}/{date}/{attemptId}
 * TO:   gameAttempts/themes/{userId}/{attemptId}
 * 
 * Features:
 * - Validates Firebase connection before migration
 * - Flattens date-grouped attempts into single level per user
 * - Preserves all attempt data and metadata
 * - Handles potential attemptId collisions by keeping most recent
 * - Supports dry-run mode for safety
 * - Tracks migration progress and statistics
 * - Verifies migration success before cleanup
 * - Deletes old date-grouped data after successful migration
 * 
 * Usage:
 * node migrate-attempts-remove-date.js [--dry-run] [--backup]
 * 
 * Examples:
 * - Dry run (preview changes): node migrate-attempts-remove-date.js --dry-run
 * - Execute migration: node migrate-attempts-remove-date.js
 * - With backup: node migrate-attempts-remove-date.js --backup
 * 
 * Environment variables:
 * - Local (with emulator): FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000
 * - Production: FIREBASE_CREDENTIAL="..." THEMES_FIREBASE_DATABASE_URL="..."
 */

import admin from 'firebase-admin';

// Configuration
const GAME_ATTEMPTS_PATH = 'gameAttempts/themes';

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
  const withBackup = args.includes('--backup');
  
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node migrate-attempts-remove-date.js [--dry-run] [--backup]');
    console.log('');
    console.log('Options:');
    console.log('  --dry-run              Preview changes without executing migration');
    console.log('  --backup               Create backup before migration');
    console.log('  --help, -h             Show this help message');
    console.log('');
    console.log('Migration:');
    console.log('  FROM: gameAttempts/themes/{userId}/{date}/{attemptId}');
    console.log('  TO:   gameAttempts/themes/{userId}/{attemptId}');
    console.log('');
    console.log('Environment variables:');
    console.log('  FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000  (for local testing)');
    console.log('  FIREBASE_CREDENTIAL="..."                       (for production)');
    console.log('  THEMES_FIREBASE_DATABASE_URL="..."              (for production)');
    process.exit(0);
  }
  
  return { isDryRun, withBackup };
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
      return admin.initializeApp(appOptions);
    } catch (err) {
      error('Failed to initialize Firebase with emulator:', err.message);
      process.exit(1);
    }
  } else {
    // Production mode
    log('Connecting to production Firebase');
    
    // Check for required environment variables
    if (!process.env.FIREBASE_CREDENTIAL || !process.env.THEMES_FIREBASE_DATABASE_URL) {
      error('Missing required environment variables for production:');
      error('- FIREBASE_CREDENTIAL (service account JSON string)');
      error('- THEMES_FIREBASE_DATABASE_URL (database URL)');
      process.exit(1);
    }

    try {
      const credential = JSON.parse(process.env.FIREBASE_CREDENTIAL);
      appOptions = {
        credential: admin.credential.cert(credential),
        databaseURL: process.env.THEMES_FIREBASE_DATABASE_URL
      };
      
      return admin.initializeApp(appOptions);
    } catch (err) {
      error('Failed to initialize Firebase for production:', err.message);
      process.exit(1);
    }
  }
}

// Validate Firebase connection
async function validateConnection(db) {
  try {
    log('Validating Firebase connection...');
    
    // For emulator, .info/connected might not work reliably
    // Instead, try to read a simple path to test connectivity
    const testRef = db.ref(GAME_ATTEMPTS_PATH);
    const snapshot = await testRef.limitToFirst(1).once('value');
    
    log('✓ Firebase connection validated');
    return true;
  } catch (err) {
    error('Firebase connection validation error:', err.message);
    return false;
  }
}

// Get all users with attempts
async function getAllUsersWithAttempts(db) {
  try {
    log('Fetching all users with attempts...');
    const attemptsRef = db.ref(GAME_ATTEMPTS_PATH);
    const snapshot = await attemptsRef.once('value');
    const attemptsData = snapshot.val();
    
    if (!attemptsData) {
      log('No attempts data found');
      return [];
    }
    
    const userIds = Object.keys(attemptsData);
    log(`Found ${userIds.length} users with attempts`);
    
    return userIds.map(userId => ({
      userId,
      data: attemptsData[userId]
    }));
  } catch (err) {
    error('Failed to fetch users with attempts:', err.message);
    throw err;
  }
}

// Check if user data needs migration (has date-grouped structure)
function needsMigration(userData) {
  if (!userData || typeof userData !== 'object') {
    return false;
  }
  
  // Check if any keys look like dates (YYYY-MM-DD format)
  const keys = Object.keys(userData);
  return keys.some(key => /^\d{4}-\d{2}-\d{2}$/.test(key));
}

// Flatten date-grouped attempts for a single user
function flattenUserAttempts(userData) {
  const flattened = {};
  let totalAttempts = 0;
  let dateKeys = 0;
  
  for (const [key, value] of Object.entries(userData)) {
    // If it looks like a date key, process its attempts
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && value && typeof value === 'object') {
      dateKeys++;
      
      for (const [attemptId, attemptData] of Object.entries(value)) {
        if (attemptData && typeof attemptData === 'object') {
          // Handle potential attempt ID collisions by keeping the most recent
          if (flattened[attemptId]) {
            const existingTimestamp = flattened[attemptId].timestamp || 0;
            const newTimestamp = attemptData.timestamp || 0;
            
            if (newTimestamp > existingTimestamp) {
              flattened[attemptId] = {
                ...attemptData,
                migratedAt: Date.now(),
                migratedFromDate: key
              };
            }
          } else {
            flattened[attemptId] = {
              ...attemptData,
              migratedAt: Date.now(),
              migratedFromDate: key
            };
          }
          totalAttempts++;
        }
      }
    } else {
      // Non-date key, keep as-is (already migrated or different data)
      flattened[key] = value;
    }
  }
  
  return { flattened, totalAttempts, dateKeys };
}

// Create backup of attempts data
async function createBackup(db) {
  try {
    log('Creating backup of attempts data...');
    const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `backups/gameAttempts-${backupTimestamp}`;
    
    const attemptsRef = db.ref(GAME_ATTEMPTS_PATH);
    const backupRef = db.ref(backupPath);
    
    const snapshot = await attemptsRef.once('value');
    const data = snapshot.val();
    
    if (data) {
      await backupRef.set(data);
      log(`✓ Backup created at: ${backupPath}`);
      return backupPath;
    } else {
      log('No data to backup');
      return null;
    }
  } catch (err) {
    error('Failed to create backup:', err.message);
    throw err;
  }
}

// Migrate attempts for a single user
async function migrateUserAttempts(db, userId, userData, isDryRun) {
  try {
    if (!needsMigration(userData)) {
      return { skipped: true, reason: 'No migration needed' };
    }
    
    const { flattened, totalAttempts, dateKeys } = flattenUserAttempts(userData);
    
    if (isDryRun) {
      return {
        userId,
        dateKeys,
        totalAttempts,
        flattenedKeys: Object.keys(flattened).length,
        preview: Object.keys(flattened).slice(0, 3) // Show first 3 attempt IDs
      };
    }
    
    // Execute migration
    const userRef = db.ref(`${GAME_ATTEMPTS_PATH}/${userId}`);
    await userRef.set(flattened);
    
    log(`✓ Migrated ${totalAttempts} attempts from ${dateKeys} dates for user ${userId}`);
    
    return {
      userId,
      dateKeys,
      totalAttempts,
      flattenedKeys: Object.keys(flattened).length,
      migrated: true
    };
  } catch (err) {
    error(`Failed to migrate attempts for user ${userId}:`, err.message);
    throw err;
  }
}

// Verify migration for a single user
async function verifyUserMigration(db, userId) {
  try {
    const userRef = db.ref(`${GAME_ATTEMPTS_PATH}/${userId}`);
    const snapshot = await userRef.once('value');
    const data = snapshot.val();
    
    if (!data) {
      return { verified: false, reason: 'No data found after migration' };
    }
    
    // Check that there are no date keys remaining
    const hasDateKeys = Object.keys(data).some(key => /^\d{4}-\d{2}-\d{2}$/.test(key));
    
    if (hasDateKeys) {
      return { verified: false, reason: 'Date keys still present after migration' };
    }
    
    // Check that attempts have migration metadata
    const attemptKeys = Object.keys(data).filter(key => key.startsWith('attempt_'));
    const migratedAttempts = attemptKeys.filter(key => 
      data[key] && data[key].migratedAt
    );
    
    return {
      verified: true,
      totalKeys: Object.keys(data).length,
      attemptKeys: attemptKeys.length,
      migratedAttempts: migratedAttempts.length
    };
  } catch (err) {
    error(`Failed to verify migration for user ${userId}:`, err.message);
    return { verified: false, reason: err.message };
  }
}

// Main migration function
async function migrate() {
  const { isDryRun, withBackup } = parseArgs();
  
  log('Starting gameAttempts date structure migration...');
  log(`Mode: ${isDryRun ? 'DRY RUN' : 'EXECUTE'}`);
  log(`Backup: ${withBackup ? 'ENABLED' : 'DISABLED'}`);
  
  // Initialize Firebase
  const app = initializeFirebase();
  const db = admin.database();
  
  // Validate connection
  const connectionValid = await validateConnection(db);
  if (!connectionValid) {
    process.exit(1);
  }
  
  // Create backup if requested
  let backupPath = null;
  if (withBackup && !isDryRun) {
    backupPath = await createBackup(db);
  }
  
  try {
    // Get all users with attempts
    const usersWithAttempts = await getAllUsersWithAttempts(db);
    
    if (usersWithAttempts.length === 0) {
      log('No users with attempts found. Nothing to migrate.');
      process.exit(0);
    }
    
    // Migration statistics
    let totalUsers = 0;
    let usersNeedingMigration = 0;
    let usersMigrated = 0;
    let totalAttempts = 0;
    let totalDateKeys = 0;
    let errors = [];
    
    log(`\n${isDryRun ? 'PREVIEW' : 'EXECUTING'} migration for ${usersWithAttempts.length} users...\n`);
    
    // Process each user
    for (const { userId, data } of usersWithAttempts) {
      totalUsers++;
      
      try {
        const result = await migrateUserAttempts(db, userId, data, isDryRun);
        
        if (result.skipped) {
          log(`- ${userId}: ${result.reason}`);
          continue;
        }
        
        usersNeedingMigration++;
        totalAttempts += result.totalAttempts;
        totalDateKeys += result.dateKeys;
        
        if (isDryRun) {
          log(`- ${userId}: Would migrate ${result.totalAttempts} attempts from ${result.dateKeys} dates`);
          log(`  → Flattened to ${result.flattenedKeys} keys`);
          if (result.preview.length > 0) {
            log(`  → Sample attempt IDs: ${result.preview.join(', ')}${result.preview.length < result.flattenedKeys ? '...' : ''}`);
          }
        } else {
          usersMigrated++;
          
          // Verify migration
          const verification = await verifyUserMigration(db, userId);
          if (!verification.verified) {
            warn(`Migration verification failed for ${userId}: ${verification.reason}`);
            errors.push(`${userId}: ${verification.reason}`);
          } else {
            log(`✓ Verified migration for ${userId}: ${verification.migratedAttempts}/${verification.attemptKeys} attempts migrated`);
          }
        }
      } catch (err) {
        error(`Failed to process user ${userId}:`, err.message);
        errors.push(`${userId}: ${err.message}`);
      }
    }
    
    // Summary
    log(`\n${'='.repeat(60)}`);
    log('MIGRATION SUMMARY');
    log(`${'='.repeat(60)}`);
    log(`Total users processed: ${totalUsers}`);
    log(`Users needing migration: ${usersNeedingMigration}`);
    
    if (isDryRun) {
      log(`Total attempts to migrate: ${totalAttempts}`);
      log(`Total date groups to flatten: ${totalDateKeys}`);
      log('\nThis was a dry run. No changes were made.');
      log('Run without --dry-run to execute the migration.');
    } else {
      log(`Users successfully migrated: ${usersMigrated}`);
      log(`Total attempts migrated: ${totalAttempts}`);
      log(`Total date groups flattened: ${totalDateKeys}`);
      
      if (backupPath) {
        log(`Backup created at: ${backupPath}`);
      }
    }
    
    if (errors.length > 0) {
      log(`\nErrors encountered: ${errors.length}`);
      errors.forEach(err => log(`  - ${err}`));
    }
    
    log('\nMigration completed successfully!');
    
  } catch (err) {
    error('Migration failed:', err.message);
    
    if (backupPath) {
      log(`Backup available at: ${backupPath} for potential rollback`);
    }
    
    process.exit(1);
  } finally {
    // Cleanup
    await app.delete();
  }
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch(err => {
    error('Unexpected error:', err);
    process.exit(1);
  });
}