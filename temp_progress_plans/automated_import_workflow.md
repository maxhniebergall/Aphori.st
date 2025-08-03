# Automated Import Workflow Implementation

## Overview
Automated scripts for generating puzzles and uploading them directly to Firebase RTDB without manual validation steps, using quality thresholds to ensure acceptable puzzle quality.

## Automated Process Overview

### Single-Command Generation and Upload
```bash
cd scripts/puzzle-generation
npm run generate-and-upload 2025-08-05 2025-08-11 3 0.5
```

### Separate Generation and Upload (Optional)
```bash
npm run generate 2025-08-05 2025-08-11 3 ./output 0.5
npm run upload ./output
```

## Implementation Plan

### Phase 1: Firebase Admin Integration

#### 1.1 Firebase Admin Setup
**File:** `scripts/puzzle-generation/firebase-admin.ts`
```typescript
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

export class FirebaseUploader {
  private db: any;

  constructor() {
    // Initialize Firebase Admin SDK
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
    const databaseURL = process.env.FIREBASE_DATABASE_URL || 'https://your-project.firebaseio.com';

    initializeApp({
      credential: cert(serviceAccount),
      databaseURL
    });

    this.db = getDatabase();
  }

  async uploadPuzzles(date: string, puzzles: GeneratedPuzzle[]): Promise<void> {
    console.log(`📤 Uploading ${puzzles.length} puzzles for ${date}...`);

    try {
      // Prepare data structure
      const puzzleData = puzzles.reduce((acc, puzzle) => {
        acc[puzzle.id] = puzzle;
        return acc;
      }, {} as Record<string, any>);

      const indexData = {
        count: puzzles.length,
        lastUpdated: Date.now(),
        status: 'published',
        puzzleIds: puzzles.map(p => p.id),
        metadata: {
          generatedAt: Date.now(),
          generatorVersion: '1.0.0',
          qualityScore: puzzles.reduce((sum, p) => sum + p.metadata.qualityScore, 0) / puzzles.length
        }
      };

      // Upload puzzles and index atomically
      const updates = {
        [`dailyPuzzles/themes/${date}`]: puzzleData,
        [`puzzleIndex/themes/${date}`]: indexData
      };

      await this.db.ref().update(updates);
      console.log(`✅ Successfully uploaded puzzles for ${date}`);

    } catch (error) {
      console.error(`❌ Failed to upload puzzles for ${date}:`, error);
      throw error;
    }
  }

  async batchUpload(puzzlesByDate: Record<string, GeneratedPuzzle[]>): Promise<void> {
    console.log(`📦 Batch uploading ${Object.keys(puzzlesByDate).length} dates...`);

    const updates: Record<string, any> = {};

    for (const [date, puzzles] of Object.entries(puzzlesByDate)) {
      const puzzleData = puzzles.reduce((acc, puzzle) => {
        acc[puzzle.id] = puzzle;
        return acc;
      }, {} as Record<string, any>);

      const indexData = {
        count: puzzles.length,
        lastUpdated: Date.now(),
        status: 'published',
        puzzleIds: puzzles.map(p => p.id),
        metadata: {
          generatedAt: Date.now(),
          generatorVersion: '1.0.0',
          qualityScore: puzzles.reduce((sum, p) => sum + p.metadata.qualityScore, 0) / puzzles.length
        }
      };

      updates[`dailyPuzzles/themes/${date}`] = puzzleData;
      updates[`puzzleIndex/themes/${date}`] = indexData;
    }

    try {
      await this.db.ref().update(updates);
      console.log(`✅ Batch upload complete: ${Object.keys(puzzlesByDate).length} dates`);
    } catch (error) {
      console.error('❌ Batch upload failed:', error);
      throw error;
    }
  }

  async checkExistingPuzzles(date: string): Promise<boolean> {
    try {
      const snapshot = await this.db.ref(`puzzleIndex/themes/${date}`).once('value');
      const index = snapshot.val();
      return index && index.status === 'published' && index.count > 0;
    } catch (error) {
      console.error(`Error checking existing puzzles for ${date}:`, error);
      return false;
    }
  }

  async backupExistingData(dates: string[]): Promise<void> {
    console.log('💾 Creating backup of existing data...');
    
    const backupData: Record<string, any> = {};
    
    for (const date of dates) {
      try {
        const puzzlesSnapshot = await this.db.ref(`dailyPuzzles/themes/${date}`).once('value');
        const indexSnapshot = await this.db.ref(`puzzleIndex/themes/${date}`).once('value');
        
        if (puzzlesSnapshot.exists()) {
          backupData[`dailyPuzzles/themes/${date}`] = puzzlesSnapshot.val();
        }
        if (indexSnapshot.exists()) {
          backupData[`puzzleIndex/themes/${date}`] = indexSnapshot.val();
        }
      } catch (error) {
        console.warn(`Warning: Could not backup data for ${date}:`, error);
      }
    }

    if (Object.keys(backupData).length > 0) {
      const backupFilename = `./backups/backup_${Date.now()}.json`;
      await fs.writeFile(backupFilename, JSON.stringify(backupData, null, 2));
      console.log(`📁 Backup saved: ${backupFilename}`);
    }
  }
}
```

### Phase 2: Enhanced Generation Script with Auto-Upload

#### 2.1 Updated Generation Script
**File:** `scripts/puzzle-generation/generate-and-upload.ts`
```typescript
#!/usr/bin/env node

interface AutoGenerationConfig extends GenerationConfig {
  autoUpload: boolean;
  skipExisting: boolean;
  createBackup: boolean;
  forceOverwrite: boolean;
}

export class AutomatedPuzzleGeneration {
  constructor(
    private vectorLoader: FullVectorLoader,
    private puzzleGenerator: HighQualityPuzzleGenerator,
    private firebaseUploader: FirebaseUploader
  ) {}

  async generateAndUpload(config: AutoGenerationConfig): Promise<void> {
    console.log(`🚀 Starting automated puzzle generation and upload...`);
    console.log(`📅 Date range: ${config.startDate} to ${config.endDate}`);
    console.log(`🎯 Quality threshold: ${config.qualityThreshold}`);
    console.log(`📤 Auto-upload: ${config.autoUpload}`);
    console.log(`🧩 Difficulty algorithm: N = K + D (progressive category difficulty)`);

    const dates = this.generateDateRange(config.startDate, config.endDate);
    const allPuzzles: Record<string, GeneratedPuzzle[]> = {};
    const skippedDates: string[] = [];

    // Check existing puzzles
    if (config.skipExisting) {
      console.log('🔍 Checking for existing puzzles...');
      for (const date of dates) {
        const exists = await this.firebaseUploader.checkExistingPuzzles(date);
        if (exists && !config.forceOverwrite) {
          skippedDates.push(date);
          console.log(`⏭️  Skipping ${date} (puzzles already exist)`);
        }
      }
    }

    const datesToGenerate = dates.filter(date => !skippedDates.includes(date));

    if (datesToGenerate.length === 0) {
      console.log('ℹ️  No dates to generate (all already exist)');
      return;
    }

    // Create backup if requested
    if (config.createBackup && config.autoUpload) {
      await this.firebaseUploader.backupExistingData(datesToGenerate);
    }

    // Generate puzzles
    console.log(`🎲 Generating puzzles for ${datesToGenerate.length} dates...`);
    for (const date of datesToGenerate) {
      try {
        const output = await this.puzzleGenerator.generateDailyPuzzles(date, config.puzzlesPerDay);
        
        if (output.puzzles.length > 0) {
          allPuzzles[date] = output.puzzles;
          console.log(`✅ ${date}: Generated ${output.puzzles.length}/${config.puzzlesPerDay} puzzles (avg quality: ${output.metadata.qualityScore.toFixed(2)})`);
        } else {
          console.log(`❌ ${date}: Failed to generate puzzles`);
        }
      } catch (error) {
        console.error(`💥 ${date}: Generation error - ${error.message}`);
      }
    }

    // Upload if enabled
    if (config.autoUpload && Object.keys(allPuzzles).length > 0) {
      console.log('📤 Uploading to Firebase...');
      try {
        await this.firebaseUploader.batchUpload(allPuzzles);
        console.log('🎉 All puzzles uploaded successfully!');
      } catch (error) {
        console.error('💥 Upload failed:', error);
        
        // Save locally as fallback
        console.log('💾 Saving locally as fallback...');
        await this.saveLocalFallback(allPuzzles, config.outputDir);
      }
    } else {
      // Save locally
      console.log('💾 Saving puzzles locally...');
      await this.saveLocalFallback(allPuzzles, config.outputDir);
    }

    // Summary
    const totalPuzzles = Object.values(allPuzzles).reduce((sum, puzzles) => sum + puzzles.length, 0);
    console.log(`\n📊 Summary:`);
    console.log(`✅ Generated: ${Object.keys(allPuzzles).length} dates, ${totalPuzzles} puzzles`);
    console.log(`⏭️  Skipped: ${skippedDates.length} dates`);
    console.log(`📤 Uploaded: ${config.autoUpload ? 'Yes' : 'No'}`);
  }

  private async saveLocalFallback(allPuzzles: Record<string, GeneratedPuzzle[]>, outputDir: string): Promise<void> {
    await this.ensureOutputDir(outputDir);
    
    for (const [date, puzzles] of Object.entries(allPuzzles)) {
      const firebaseData = {
        [`dailyPuzzles/themes/${date}`]: puzzles.reduce((acc, puzzle) => {
          acc[puzzle.id] = puzzle;
          return acc;
        }, {} as Record<string, any>),
        
        [`puzzleIndex/themes/${date}`]: {
          count: puzzles.length,
          lastUpdated: Date.now(),
          status: 'generated',
          puzzleIds: puzzles.map(p => p.id)
        }
      };

      const filename = `${outputDir}/puzzles_${date}.json`;
      await fs.writeFile(filename, JSON.stringify(firebaseData, null, 2));
    }
  }
}

// CLI Interface
async function main() {
  const config: AutoGenerationConfig = {
    startDate: process.argv[2] || '2025-08-05',
    endDate: process.argv[3] || '2025-08-11',
    puzzlesPerDay: parseInt(process.argv[4]) || 3,
    qualityThreshold: parseFloat(process.argv[5]) || 0.5,
    outputDir: './generated-puzzles',
    autoUpload: process.argv.includes('--upload'),
    skipExisting: !process.argv.includes('--force'),
    createBackup: process.argv.includes('--backup'),
    forceOverwrite: process.argv.includes('--force')
  };

  console.log('🚀 Initializing services...');
  const vectorLoader = new FullVectorLoader();
  await vectorLoader.initialize();

  const firebaseUploader = new FirebaseUploader();
  
  const automation = new AutomatedPuzzleGeneration(
    vectorLoader,
    new HighQualityPuzzleGenerator(vectorLoader),
    firebaseUploader
  );

  await automation.generateAndUpload(config);
  console.log('✨ Process complete!');
}

if (require.main === module) {
  main().catch(console.error);
}
```

### Phase 3: Simple Upload-Only Script

#### 3.1 Standalone Upload Script
**File:** `scripts/puzzle-generation/upload-existing.ts`
```typescript
#!/usr/bin/env node

export class PuzzleUploader {
  constructor(private firebaseUploader: FirebaseUploader) {}

  async uploadFromDirectory(inputDir: string): Promise<void> {
    console.log(`📁 Scanning directory: ${inputDir}`);
    
    const files = await fs.readdir(inputDir);
    const puzzleFiles = files.filter(f => f.startsWith('puzzles_') && f.endsWith('.json'));
    
    console.log(`📦 Found ${puzzleFiles.length} puzzle files`);

    for (const file of puzzleFiles) {
      try {
        const filePath = `${inputDir}/${file}`;
        const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
        
        // Extract date from filename
        const dateMatch = file.match(/puzzles_(\d{4}-\d{2}-\d{2})\.json/);
        if (!dateMatch) {
          console.log(`⚠️  Skipping ${file}: Invalid filename format`);
          continue;
        }
        
        const date = dateMatch[1];
        
        // Extract puzzles from Firebase format
        const puzzlePath = `dailyPuzzles/themes/${date}`;
        const puzzleData = data[puzzlePath];
        
        if (!puzzleData) {
          console.log(`⚠️  Skipping ${file}: No puzzle data found`);
          continue;
        }
        
        const puzzles = Object.values(puzzleData) as GeneratedPuzzle[];
        
        // Upload to Firebase
        await this.firebaseUploader.uploadPuzzles(date, puzzles);
        console.log(`✅ Uploaded ${file}: ${puzzles.length} puzzles`);
        
      } catch (error) {
        console.error(`❌ Failed to upload ${file}:`, error);
      }
    }
  }
}

// CLI usage
async function main() {
  const inputDir = process.argv[2] || './generated-puzzles';
  
  console.log('🚀 Initializing Firebase uploader...');
  const firebaseUploader = new FirebaseUploader();
  const uploader = new PuzzleUploader(firebaseUploader);
  
  await uploader.uploadFromDirectory(inputDir);
  console.log('✨ Upload process complete!');
}

if (require.main === module) {
  main().catch(console.error);
}
```

### Phase 4: Package Scripts and Environment

#### 4.1 Updated Package.json
**File:** `scripts/puzzle-generation/package.json`
```json
{
  "name": "themes-puzzle-generator",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "generate": "node dist/generate-puzzles.js",
    "generate-and-upload": "node dist/generate-and-upload.js",
    "upload": "node dist/upload-existing.js",
    "upload-week": "npm run generate-and-upload -- $(date +%Y-%m-%d) $(date -d '+7 days' +%Y-%m-%d) 3 0.5 --upload",
    "generate-week": "npm run generate-and-upload -- $(date +%Y-%m-%d) $(date -d '+7 days' +%Y-%m-%d) 3 0.5",
    "force-upload": "npm run generate-and-upload -- $(date +%Y-%m-%d) $(date -d '+7 days' +%Y-%m-%d) 3 0.5 --upload --force",
    "test-difficulty": "npm run generate-and-upload -- $(date +%Y-%m-%d) $(date +%Y-%m-%d) 1 0.3 --verbose",
    "analyze-difficulty": "node dist/analyze-difficulty.js"
  },
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "faiss": "^1.0.0",
    "@types/node": "^18.0.0",
    "typescript": "^5.0.0"
  }
}
```

#### 4.2 Environment Setup
**File:** `scripts/puzzle-generation/.env.example`
```env
# Firebase Configuration
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com

# Generation Settings
DEFAULT_QUALITY_THRESHOLD=0.5
DEFAULT_PUZZLES_PER_DAY=3
```

## Usage Examples

### Generate and Upload Automatically
```bash
cd scripts/puzzle-generation

# Setup
npm install
npm run build

# Generate next week and upload immediately
npm run upload-week

# Generate specific date range
npm run generate-and-upload 2025-08-05 2025-08-11 3 0.5 --upload

# Force overwrite existing puzzles
npm run generate-and-upload 2025-08-05 2025-08-11 3 0.5 --upload --force

# Generate with backup
npm run generate-and-upload 2025-08-05 2025-08-11 3 0.5 --upload --backup
```

### Upload Existing Files
```bash
# Upload all files from directory
npm run upload ./generated-puzzles

# Upload specific directory
npm run upload ./backlog-puzzles
```

## Success Criteria
- ✅ Generate high-quality puzzles automatically with 0.5+ quality threshold
- ✅ Upload directly to Firebase without manual intervention
- ✅ Skip existing dates automatically (with --force override)
- ✅ Create backups when overwriting existing data
- ✅ Fallback to local save if upload fails
- ✅ Simple CLI commands for daily/weekly generation

## Benefits of Automation
- ✅ **No Manual Steps**: Complete automation from generation to deployment
- ✅ **Quality Threshold**: Automatic filtering ensures minimum quality
- ✅ **Safe Operations**: Backup and skip-existing prevent data loss
- ✅ **Simple Commands**: One-line commands for common operations
- ✅ **Flexible**: Can generate locally or upload directly
- ✅ **Robust**: Fallback mechanisms for failed uploads

## Dependencies
- Firebase Admin SDK with service account
- Full vector index access (2.9M words)
- Node.js/TypeScript environment
- Firebase project with RTDB access

This automated workflow eliminates manual validation while maintaining quality through configurable thresholds and automatic backup procedures.