# Database Migration Scripts

This directory contains scripts for managing database migrations for the Aphorist application, specifically for uploading new puzzle sets to the Firebase Realtime Database.

## Scripts Overview

### `upload-puzzles.js`

The main migration script that safely uploads new puzzle sets from the puzzle generation pipeline to the `aphorist-themes` Firebase RTDB without overwriting existing data.

#### Features

- **Safe merging**: Never overwrites existing puzzles, only adds new ones
- **Atomic operations**: Uses Firebase transactions to ensure data consistency
- **Backup creation**: Automatically creates timestamped backups before any changes
- **Environment flexibility**: Works with both Firebase emulator (local) and production
- **Verification**: Confirms successful upload after migration
- **Detailed logging**: Comprehensive logging for debugging and audit trails

## Usage

### Prerequisites

1. Install dependencies:
   ```bash
   cd .database-migration-scripts
   npm install
   ```

2. Ensure puzzle data exists:
   ```bash
   # The script expects puzzle data at:
   # scripts/puzzle-generation/batch-output/unified-firebase-puzzles.json
   ```

### Local Testing (with Firebase Emulator)

1. Start Firebase emulator:
   ```bash
   firebase emulators:start --only database
   ```

2. Run migration against emulator:
   ```bash
   cd .database-migration-scripts
   npm run test-local
   # OR
   FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000 node upload-puzzles.js
   ```

### Production Deployment

The script is designed to run in the CI/CD pipeline with the following environment variables:

```bash
FIREBASE_CREDENTIAL="<service-account-json>"
THEMES_FIREBASE_DATABASE_URL="https://aphorist-themes-default-rtdb.firebaseio.com/?ns=aphorist-themes"
node upload-puzzles.js
```

## Data Structure

The script expects puzzle data in the following format:

```json
{
  "puzzleSets": {
    "setName": {
      "4x4": {
        "puzzleId1": {
          "id": "puzzleId1",
          "setName": "setName",
          "puzzleNumber": 1,
          "gridSize": 4,
          "words": ["word1", "word2", ...],
          "categories": [...],
          "metadata": {...}
        }
      }
    }
  }
}
```

## Migration Logic

### Merge Strategy

1. **New puzzle sets**: Added entirely to the database
2. **Existing puzzle sets**: 
   - New grid sizes are added to the set
   - Existing grid sizes are merged at the puzzle level
   - Individual puzzles are never overwritten if they already exist

### Safety Measures

1. **Backup Creation**: Before any changes, the current state is backed up to `./backups/`
2. **Transaction Safety**: All writes use Firebase transactions for atomicity
3. **Verification**: After upload, the script verifies all data was written correctly
4. **Error Handling**: Comprehensive error handling with detailed logging

### Example Migration Flow

```
1. Load current data from Firebase → Create backup
2. Load new puzzle data from JSON file
3. Merge new data with existing data:
   - Set "wiki_batch_2025-08-26" exists → merge puzzles
   - Set "new_set_2025-08-27" doesn't exist → add entirely
4. Upload merged data using transaction
5. Verify all new puzzles are present
6. Log summary of changes
```

## Backup System

Backups are automatically created in the `./backups/` directory with timestamps:

```
./backups/
├── puzzleSets-backup-2025-08-26T10-30-45-123Z.json
├── puzzleSets-backup-2025-08-26T11-15-20-456Z.json
└── ...
```

### Restoring from Backup

To restore from a backup (manual process):

```bash
# Load backup data and upload to Firebase
node -e "
const admin = require('firebase-admin');
const fs = require('fs');
const backup = JSON.parse(fs.readFileSync('./backups/puzzleSets-backup-TIMESTAMP.json'));
// Initialize Firebase and upload backup data
"
```

## CI/CD Integration

The script is integrated into `.github/workflows/deploy.yml` and runs:

1. After code checkout
2. Before building Docker images
3. With production Firebase credentials
4. With error handling that stops deployment if migration fails

## Logging

The script provides comprehensive logging:

- **Info**: General progress and summary information
- **Error**: Failures and stack traces
- **Debug**: Detailed operation information

All logs include timestamps and are structured for easy parsing.

## Troubleshooting

### Common Issues

1. **"Puzzle data file not found"**
   - Ensure `scripts/puzzle-generation/batch-output/unified-firebase-puzzles.json` exists
   - Run puzzle generation script first

2. **"FIREBASE_CREDENTIAL environment variable is required"**
   - Set Firebase service account credentials for production mode
   - For local testing, use emulator mode instead

3. **"Verification failed"**
   - Check Firebase permissions
   - Review transaction conflicts in logs
   - Examine backup file for data corruption

4. **Permission errors**
   - Ensure Firebase service account has `Database Admin` role
   - Verify database rules allow writes to `puzzleSets` path

### Debug Mode

For verbose logging, set environment variables:

```bash
DEBUG=* node upload-puzzles.js
```

## Security Considerations

- Never commit Firebase credentials to git
- Use environment variables for sensitive configuration
- Backup files may contain sensitive data - handle appropriately
- Review Firebase security rules before production deployment

## Development

To modify the migration script:

1. Test changes against emulator first
2. Create comprehensive backups before production testing
3. Update this documentation with any new features or changes
4. Ensure error handling covers new failure modes