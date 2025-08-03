# Firebase Schema and Backend Updates Implementation

## Overview
Update Firebase schema and backend API to read from pre-generated puzzles while maintaining backward compatibility with real-time generation as fallback.

## Firebase Schema Design

### New Storage Structure
```
/dailyPuzzles/themes/{YYYY-MM-DD}/
  ├── themes_2025-08-05_1/
  │   ├── id: "themes_2025-08-05_1"
  │   ├── date: "2025-08-05"
  │   ├── puzzleNumber: 1
  │   ├── gridSize: 4
  │   ├── difficulty: "medium"
  │   ├── categories: [...]
  │   ├── words: [...]
  │   └── metadata: {
  │       ├── generatedAt: 1754108800000
  │       ├── avgSimilarity: 0.65
  │       └── qualityScore: 0.78
  │   }
  ├── themes_2025-08-05_2/
  └── themes_2025-08-05_3/

/puzzleIndex/themes/{YYYY-MM-DD}/
  ├── count: 3
  ├── lastUpdated: 1754108800000
  ├── status: "published"
  ├── puzzleIds: ["themes_2025-08-05_1", "themes_2025-08-05_2", "themes_2025-08-05_3"]
  └── metadata: {
      ├── generatedAt: 1754108800000
      ├── generatorVersion: "1.0.0"
      └── qualityScore: 0.78
  }
```

### Import JSON Structure
Generated scripts will output JSON in this format:
```json
{
  "dailyPuzzles/themes/2025-08-05": {
    "themes_2025-08-05_1": { /* puzzle data */ },
    "themes_2025-08-05_2": { /* puzzle data */ },
    "themes_2025-08-05_3": { /* puzzle data */ }
  },
  "puzzleIndex/themes/2025-08-05": {
    "count": 3,
    "lastUpdated": 1754108800000,
    "status": "published",
    "puzzleIds": ["themes_2025-08-05_1", "themes_2025-08-05_2", "themes_2025-08-05_3"],
    "metadata": { /* generation metadata */ }
  }
}
```

## Implementation Plan

### Phase 1: Backend API Updates (Minimal Changes)

#### 1.1 Update Database Path Constants
**File:** `backend/types/games/themes.ts`
```typescript
export const THEMES_DB_PATHS = {
  // New paths for stored puzzles
  STORED_DAILY_PUZZLES: (date: string) => `dailyPuzzles/themes/${date}`,
  STORED_PUZZLE_INDEX: (date: string) => `puzzleIndex/themes/${date}`,
  
  // Keep existing paths unchanged
  USER_PROGRESS: (userId: string) => `gameProgress/themes/users/${userId}`,
  TEMP_USER_PROGRESS: (userId: string) => `gameProgress/themes/tempUsers/${userId}`,
  USER_ATTEMPTS: (userId: string, date: string) => `gameAttempts/themes/${userId}/${date}`,
  ATTEMPT: (userId: string, date: string, attemptId: string) => `gameAttempts/themes/${userId}/${date}/${attemptId}`,
};
```

#### 1.2 Add Hybrid Puzzle Loading
**File:** `backend/services/games/SimpleThemesPuzzleGenerator.ts`
```typescript
export class SimpleThemesPuzzleGenerator {
  // ... existing code

  /**
   * Try stored puzzles first, fall back to generation
   */
  async getDailyPuzzles(date: string): Promise<ThemesPuzzle[]> {
    // 1. Try to load from stored puzzles
    const storedPuzzles = await this.loadStoredPuzzles(date);
    if (storedPuzzles.length > 0) {
      logger.info(`Loaded ${storedPuzzles.length} stored puzzles for ${date}`);
      return storedPuzzles;
    }

    // 2. Fall back to real-time generation
    logger.info(`No stored puzzles found for ${date}, generating in real-time`);
    return await this.generateDailyPuzzles(date);
  }

  /**
   * Load puzzles from Firebase storage
   */
  private async loadStoredPuzzles(date: string): Promise<ThemesPuzzle[]> {
    try {
      // Check index first for quick validation
      const indexPath = THEMES_DB_PATHS.STORED_PUZZLE_INDEX(date);
      const index = await this.dbClient.getRawPath(indexPath);
      
      if (!index || index.status !== 'published') {
        logger.debug(`No published puzzle index found for ${date}`);
        return [];
      }

      // Load all puzzles for the date
      const puzzlePath = THEMES_DB_PATHS.STORED_DAILY_PUZZLES(date);
      const puzzlesData = await this.dbClient.getRawPath(puzzlePath);
      
      if (!puzzlesData) {
        logger.debug(`No puzzle data found for ${date}`);
        return [];
      }

      // Convert stored format to current ThemesPuzzle format
      const puzzles = Object.values(puzzlesData) as any[];
      return puzzles.map(puzzle => this.convertStoredPuzzle(puzzle));
      
    } catch (error) {
      logger.error(`Error loading stored puzzles for ${date}:`, error);
      return [];
    }
  }

  /**
   * Convert stored puzzle format to current format (if needed)
   */
  private convertStoredPuzzle(storedPuzzle: any): ThemesPuzzle {
    // Ensure compatibility between stored and current format
    return {
      id: storedPuzzle.id,
      date: storedPuzzle.date,
      puzzleNumber: storedPuzzle.puzzleNumber,
      gridSize: storedPuzzle.gridSize || 4,
      difficulty: storedPuzzle.difficulty || 'medium',
      categories: storedPuzzle.categories || [],
      words: storedPuzzle.words || []
    };
  }

  /**
   * Check if stored puzzles exist for a date
   */
  async hasStoredPuzzles(date: string): Promise<boolean> {
    try {
      const indexPath = THEMES_DB_PATHS.STORED_PUZZLE_INDEX(date);
      const index = await this.dbClient.getRawPath(indexPath);
      return index && index.status === 'published' && index.count > 0;
    } catch (error) {
      logger.error(`Error checking stored puzzles for ${date}:`, error);
      return false;
    }
  }

  /**
   * Get specific puzzle by ID (updated for stored puzzles)
   */
  async getPuzzle(date: string, puzzleId: string): Promise<ThemesPuzzle | null> {
    try {
      // Try stored puzzles first
      const puzzlePath = `${THEMES_DB_PATHS.STORED_DAILY_PUZZLES(date)}/${puzzleId}`;
      const storedPuzzle = await this.dbClient.getRawPath(puzzlePath);
      
      if (storedPuzzle) {
        logger.debug(`Found stored puzzle: ${puzzleId}`);
        return this.convertStoredPuzzle(storedPuzzle);
      }

      // Fall back to generated puzzles (from cache)
      const puzzles = await this.generateDailyPuzzles(date);
      return puzzles.find(p => p.id === puzzleId) || null;
      
    } catch (error) {
      logger.error(`Error getting puzzle ${puzzleId} for ${date}:`, error);
      return null;
    }
  }
}
```

### Phase 2: Configuration and Monitoring (Parallel with Phase 1)

#### 2.1 Add Configuration Options
**File:** `backend/config/database/games.ts`
```typescript
export const THEMES_CONFIG = {
  // Existing config
  VECTOR_DIMENSION: 300,
  SIMILARITY_THRESHOLD: 0.5,
  
  // New config for hybrid system
  PREFER_STORED_PUZZLES: process.env.PREFER_STORED_PUZZLES !== 'false', // Default true
  FALLBACK_TO_GENERATION: process.env.FALLBACK_TO_GENERATION !== 'false', // Default true
  LOG_PUZZLE_SOURCE: process.env.LOG_PUZZLE_SOURCE === 'true', // Default false
};
```

#### 2.2 Add Admin Endpoints for Monitoring
**File:** `backend/routes/games/themes/admin.ts`
```typescript
/**
 * GET /api/games/themes/admin/puzzle-status/:date
 * Check if puzzles exist for a date and their source
 */
router.get('/puzzle-status/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;
    
    if (!isValidDate(date)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD.'
      });
      return;
    }

    const { puzzleGenerator } = getThemesServices();
    
    // Check stored puzzles
    const hasStored = await puzzleGenerator.hasStoredPuzzles(date);
    
    let storedCount = 0;
    let storedMetadata = null;
    
    if (hasStored) {
      const indexPath = THEMES_DB_PATHS.STORED_PUZZLE_INDEX(date);
      const index = await puzzleGenerator.dbClient.getRawPath(indexPath);
      storedCount = index?.count || 0;
      storedMetadata = index?.metadata || null;
    }

    res.json({
      success: true,
      data: {
        date,
        hasStoredPuzzles: hasStored,
        storedCount,
        canGenerate: true, // Always true as fallback
        storedMetadata,
        source: hasStored ? 'stored' : 'will_generate'
      }
    });
  } catch (error) {
    logger.error('Error checking puzzle status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check puzzle status'
    });
  }
});

/**
 * GET /api/games/themes/admin/stored-dates
 * Get all dates that have stored puzzles
 */
router.get('/stored-dates', async (req: Request, res: Response) => {
  try {
    const { puzzleGenerator } = getThemesServices();
    
    // Query puzzle index for all dates
    const indexRootPath = 'puzzleIndex/themes';
    const indices = await puzzleGenerator.dbClient.getRawPath(indexRootPath);
    
    if (!indices) {
      res.json({
        success: true,
        data: {
          dates: [],
          count: 0
        }
      });
      return;
    }

    const storedDates = Object.keys(indices).filter(date => {
      const index = indices[date];
      return index && index.status === 'published' && index.count > 0;
    }).sort();

    res.json({
      success: true,
      data: {
        dates: storedDates,
        count: storedDates.length,
        dateRange: storedDates.length > 0 ? {
          start: storedDates[0],
          end: storedDates[storedDates.length - 1]
        } : null
      }
    });
  } catch (error) {
    logger.error('Error getting stored dates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get stored dates'
    });
  }
});
```

### Phase 3: Testing and Validation (Sequential - After Phase 1)

#### 3.1 Test Fallback Logic
**File:** `backend/test-stored-puzzles.ts`
```typescript
#!/usr/bin/env node

import { getThemesServices } from './routes/games/themes/index.js';
import logger from './logger.js';

async function testStoredPuzzles() {
  const { puzzleGenerator } = getThemesServices();
  
  console.log('🧪 Testing stored puzzle system...');
  
  // Test dates
  const testDates = [
    '2025-08-05', // Should have stored puzzles (if imported)
    '2025-08-20', // Should fall back to generation
    '2025-07-01'  // Should fall back to generation
  ];

  for (const date of testDates) {
    console.log(`\n📅 Testing date: ${date}`);
    
    try {
      // Check if stored puzzles exist
      const hasStored = await puzzleGenerator.hasStoredPuzzles(date);
      console.log(`   Has stored puzzles: ${hasStored}`);
      
      // Try to load puzzles
      const puzzles = await puzzleGenerator.getDailyPuzzles(date);
      console.log(`   Loaded puzzles: ${puzzles.length}`);
      
      if (puzzles.length > 0) {
        console.log(`   First puzzle ID: ${puzzles[0].id}`);
        console.log(`   Categories: ${puzzles[0].categories.length}`);
        console.log(`   Words: ${puzzles[0].words.length}`);
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n✅ Testing complete');
}

// Run test if called directly
if (require.main === module) {
  testStoredPuzzles().catch(console.error);
}
```

#### 3.2 Monitoring Integration
**File:** `backend/routes/games/themes/dailyPuzzles.ts`
```typescript
// Update existing route to log puzzle source
router.get('/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;

    if (!isValidDate(date)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD.'
      });
      return;
    }

    const { puzzleGenerator } = getThemesServices();
    
    // Check source before loading
    const hasStored = await puzzleGenerator.hasStoredPuzzles(date);
    const puzzleSource = hasStored ? 'stored' : 'generated';
    
    const puzzles = await puzzleGenerator.getDailyPuzzles(date);

    // Log puzzle source for monitoring
    if (THEMES_CONFIG.LOG_PUZZLE_SOURCE) {
      logger.info(`Served ${puzzles.length} ${puzzleSource} puzzles for ${date}`);
    }

    res.json({
      success: true,
      data: {
        date,
        puzzles,
        count: puzzles.length,
        metadata: {
          source: puzzleSource,
          loadedAt: Date.now()
        }
      }
    });
  } catch (error) {
    logger.error('Error getting daily puzzles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get daily puzzles'
    });
  }
});
```

## Implementation Timeline

1. **Day 1-2**: Phase 1 - Backend API updates for hybrid loading
2. **Day 2-3**: Phase 2 - Configuration and admin endpoints (parallel)
3. **Day 3-4**: Phase 3 - Testing and validation tools

## Success Criteria
- ✅ Backend seamlessly loads stored puzzles when available
- ✅ Falls back to real-time generation for missing dates
- ✅ Admin endpoints provide visibility into puzzle sources
- ✅ No breaking changes to existing API
- ✅ Performance improvement when using stored puzzles

## Dependencies
- Existing backend infrastructure (no new dependencies)
- Firebase database access (existing)
- Generated JSON files from local scripts

## Benefits of This Approach
- ✅ **Zero Downtime**: Existing system continues to work
- ✅ **Gradual Migration**: Import puzzles date by date
- ✅ **Automatic Fallback**: No service interruption for missing dates  
- ✅ **Simple Testing**: Easy to validate stored vs generated puzzles
- ✅ **Rollback Ready**: Can remove stored puzzles to revert to generation

## Risk Mitigation
- Maintain existing generation code as fallback
- Extensive testing of hybrid loading logic
- Admin tools for monitoring puzzle sources
- Configuration flags for enabling/disabling features
- Clear logging for debugging puzzle source issues