# Database Migration Scripts

This directory contains scripts for managing database migrations for the Aphorist application, specifically for uploading new puzzle sets to the Firebase Realtime Database.

## Scripts Overview

### `upload-puzzles.js`

The main migration script that safely uploads new puzzle sets from the puzzle generation pipeline to the `aphorist-themes` Firebase RTDB without overwriting existing data.

#### Features

- **Safe merging**: Never overwrites existing puzzles, only adds new ones
- **Atomic operations**: Uses Firebase transactions to ensure data consistency
- **Environment flexibility**: Works with both Firebase emulator (local) and production
- **Verification**: Confirms successful upload after migration
- **Detailed logging**: Comprehensive logging for debugging and audit trails

**Note**: This script relies on Firebase's automated backup system and manual backups performed before migration. Local backup creation has been removed to simplify the migration process.

## Usage

### Prerequisites

1. Install dependencies:
   ```bash
   cd .database-migration-scripts
   npm install
   ```

2. Ensure puzzle data exists:
   ```bash
   # The script looks for puzzle data in this priority order:
   # 1. DVC-managed data: scripts/datascience/themes_quality/puzzle_generation_output/gemini-puzzles_firebase.json
   # 2. Legacy format: scripts/puzzle-generation/batch-output/unified-firebase-puzzles.json
   
   # For DVC data, ensure you have access to the DVC remote and run:
   cd scripts/datascience/themes_quality
   source themes_quality_venv/bin/activate
   dvc pull puzzle_generation_output.dvc
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

The script supports two data formats:

### DVC Format (Priority 1)

The preferred format from the DVC-managed Gemini pipeline:

```json
{
  "dailyPuzzles": {
    "setName": {
      "2025-08-19": {
        "4x4": {
          "puzzleId1": {
            "id": "puzzleId1",
            "date": "2025-08-19",
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
}
```

### Legacy Format (Priority 2)

The original format for backward compatibility:

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

1. **Manual Backups**: Perform manual backups before running the script using Firebase console or automated backup system
2. **Transaction Safety**: All writes use Firebase transactions for atomicity
3. **Verification**: After upload, the script verifies all data was written correctly
4. **Error Handling**: Comprehensive error handling with detailed logging

### Example Migration Flow

```
1. Load current data from Firebase
2. Load new puzzle data from JSON file (DVC or legacy format)
3. Merge new data with existing data:
   - Set "wiki_batch_2025-08-26" exists → merge puzzles
   - Set "new_set_2025-08-27" doesn't exist → add entirely
4. Upload merged data using transaction
5. Verify all new puzzles are present
6. Log summary of changes
```

## Backup Strategy

This migration script does not create local backups. Instead, it relies on:

1. **Firebase Automated Backups**: Ensure your Firebase project has automated daily backups enabled (requires Blaze plan)
2. **Manual Pre-Migration Backups**: Perform a manual backup before running the migration script:
   - Use Firebase Console → Database → Export JSON
   - Or use Firebase CLI: `firebase database:get / > backup.json`
3. **Version Control**: Keep puzzle generation data in version control with DVC for reproducibility

### Restoring from Backup

To restore from a manual backup:

```bash
# Using Firebase CLI
firebase database:set / backup.json

# Or using REST API
curl -X PUT -d @backup.json 'https://PROJECT-ID.firebaseio.com/.json?auth=TOKEN'
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

1. **"Neither DVC puzzle data nor legacy puzzle data found"**
   - Ensure DVC data is available: `cd scripts/datascience/themes_quality && source themes_quality_venv/bin/activate && dvc pull puzzle_generation_output.dvc`
   - Or ensure legacy data exists: `scripts/puzzle-generation/batch-output/unified-firebase-puzzles.json`
   - Run puzzle generation script first

2. **"Failed to pull DVC data"**
   - Check DVC remote access and credentials
   - Ensure the themes_quality_venv virtual environment is properly set up
   - Verify DVC is installed: `dvc --version`

3. **"FIREBASE_CREDENTIAL environment variable is required"**
   - Set Firebase service account credentials for production mode
   - For local testing, use emulator mode instead

4. **"Verification failed"**
   - Check Firebase permissions
   - Review transaction conflicts in logs
   - Check if manual backup is available for restoration

5. **Permission errors**
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
- Manual backup files may contain sensitive data - handle appropriately
- Review Firebase security rules before production deployment
- Always perform manual backups before running migration scripts in production

## Development

To modify the migration script:

1. Test changes against emulator first
2. Create comprehensive backups before production testing
3. Update this documentation with any new features or changes
4. Ensure error handling covers new failure modes