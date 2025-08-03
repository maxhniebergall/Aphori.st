# Firebase Puzzle Storage Schema Implementation

## Overview
Design and implement Firebase Realtime Database schema for storing pre-generated themes game puzzles with efficient querying and backward compatibility.

## Current Storage Patterns
```
/gameAttempts/themes/{userId}/{date}/{attemptId}
/gameProgress/themes/{userType}/{userId}
/tempUsers/{tempUserId}
```

## New Storage Schema Design

### Primary Puzzle Storage
```
/dailyPuzzles/themes/{YYYY-MM-DD}/
  ├── puzzle_1/
  │   ├── id: "themes_2025-08-03_1"
  │   ├── date: "2025-08-03"
  │   ├── puzzleNumber: 1
  │   ├── gridSize: 4
  │   ├── difficulty: "medium"
  │   ├── categories: [...]
  │   ├── words: [...]
  │   ├── metadata: {
  │   │   ├── createdAt: 1754108800000
  │   │   ├── generatedBy: "script_v1.0"
  │   │   ├── version: "1.0"
  │   │   ├── quality: {
  │   │   │   ├── avgSimilarity: 0.65
  │   │   │   ├── categoryBalance: 0.85
  │   │   │   └── validated: true
  │   │   └── }
  │   └── }
  ├── puzzle_2/
  └── puzzle_3/
```

### Puzzle Index for Fast Lookup
```
/puzzleIndex/themes/
  ├── 2025-08-03: {
  │   ├── count: 3
  │   ├── lastUpdated: 1754108800000
  │   ├── status: "published"
  │   └── puzzleIds: ["themes_2025-08-03_1", "themes_2025-08-03_2", "themes_2025-08-03_3"]
  └── }
```

## Implementation Plan

### Phase 1: Database Schema Setup (Foundation - Required First)

#### 1.1 Extended TypeScript Interfaces
**File:** `backend/types/games/themes.ts`
```typescript
export interface StoredThemesPuzzle extends ThemesPuzzle {
  metadata: {
    createdAt: number;
    generatedBy: string;
    version: string;
    quality: PuzzleQualityMetrics;
  };
}

export interface PuzzleQualityMetrics {
  avgSimilarity: number;        // Average word similarity in categories
  categoryBalance: number;      // How balanced difficulty across categories
  validated: boolean;          // Manual validation flag
  rejectionReason?: string;    // If quality check failed
}

export interface DailyPuzzleIndex {
  count: number;
  lastUpdated: number;
  status: 'draft' | 'published' | 'archived';
  puzzleIds: string[];
  metadata?: {
    generatedBy: string;
    batchId?: string;
  };
}
```

#### 1.2 Update Database Path Constants
**File:** `backend/types/games/themes.ts`
```typescript
export const THEMES_DB_PATHS = {
  // New storage paths
  DAILY_PUZZLES: (date: string) => `dailyPuzzles/themes/${date}`,
  PUZZLE_BY_ID: (date: string, puzzleId: string) => `dailyPuzzles/themes/${date}/${puzzleId}`,
  PUZZLE_INDEX: (date: string) => `puzzleIndex/themes/${date}`,
  PUZZLE_INDEX_ROOT: () => `puzzleIndex/themes`,
  
  // Existing paths remain unchanged
  USER_PROGRESS: (userId: string) => `gameProgress/themes/users/${userId}`,
  TEMP_USER_PROGRESS: (userId: string) => `gameProgress/themes/tempUsers/${userId}`,
  USER_ATTEMPTS: (userId: string, date: string) => `gameAttempts/themes/${userId}/${date}`,
  ATTEMPT: (userId: string, date: string, attemptId: string) => `gameAttempts/themes/${userId}/${date}/${attemptId}`,
};
```

### Phase 2: Storage Service Implementation (Sequential - After Phase 1)

#### 2.1 Create Puzzle Storage Service
**New File:** `backend/services/games/ThemesPuzzleStorageService.ts`
```typescript
export class ThemesPuzzleStorageService {
  constructor(private dbClient: DatabaseClientInterface) {}

  async storeDailyPuzzles(date: string, puzzles: StoredThemesPuzzle[]): Promise<void> {
    // Batch write puzzles and update index
    const puzzlePath = THEMES_DB_PATHS.DAILY_PUZZLES(date);
    const indexPath = THEMES_DB_PATHS.PUZZLE_INDEX(date);
    
    // Store each puzzle
    for (const puzzle of puzzles) {
      await this.dbClient.setRawPath(`${puzzlePath}/${puzzle.id}`, puzzle);
    }
    
    // Update index
    const index: DailyPuzzleIndex = {
      count: puzzles.length,
      lastUpdated: Date.now(),
      status: 'published',
      puzzleIds: puzzles.map(p => p.id)
    };
    await this.dbClient.setRawPath(indexPath, index);
  }

  async getDailyPuzzles(date: string): Promise<StoredThemesPuzzle[]> {
    // Check index first for quick validation
    const indexPath = THEMES_DB_PATHS.PUZZLE_INDEX(date);
    const index = await this.dbClient.getRawPath(indexPath) as DailyPuzzleIndex;
    
    if (!index || index.status !== 'published') {
      return [];
    }
    
    // Load all puzzles for the date
    const puzzlePath = THEMES_DB_PATHS.DAILY_PUZZLES(date);
    const puzzlesData = await this.dbClient.getRawPath(puzzlePath);
    
    if (!puzzlesData) return [];
    
    return Object.values(puzzlesData) as StoredThemesPuzzle[];
  }

  async puzzlesExistForDate(date: string): Promise<boolean> {
    const indexPath = THEMES_DB_PATHS.PUZZLE_INDEX(date);
    const index = await this.dbClient.getRawPath(indexPath) as DailyPuzzleIndex;
    return index && index.status === 'published' && index.count > 0;
  }

  async batchUploadPuzzles(puzzlesByDate: Record<string, StoredThemesPuzzle[]>): Promise<void> {
    // Upload puzzles for multiple dates efficiently
    for (const [date, puzzles] of Object.entries(puzzlesByDate)) {
      await this.storeDailyPuzzles(date, puzzles);
    }
  }

  async getAvailableDates(): Promise<string[]> {
    const indexRoot = THEMES_DB_PATHS.PUZZLE_INDEX_ROOT();
    const indices = await this.dbClient.getRawPath(indexRoot);
    
    if (!indices) return [];
    
    return Object.keys(indices).filter(date => {
      const index = indices[date] as DailyPuzzleIndex;
      return index.status === 'published';
    });
  }
}
```

### Phase 3: Database Client Integration (Parallel with Phase 2)

#### 3.1 Extend Service Initialization
**File:** `backend/routes/games/themes/index.ts`
```typescript
// Add storage service to themes services
let storageService: ThemesPuzzleStorageService;

export function getThemesServices() {
  return {
    // ... existing services
    storageService,
  };
}

// Initialize in startup
storageService = new ThemesPuzzleStorageService(dbClient);
```

#### 3.2 Add Migration Utilities
**New File:** `backend/scripts/migrate-puzzles.ts`
```typescript
// Utility to migrate existing generated puzzles to storage format
export async function migratePuzzlesToStorage(dates: string[]): Promise<void> {
  const { puzzleGenerator, storageService } = getThemesServices();
  
  for (const date of dates) {
    const puzzles = await puzzleGenerator.generateDailyPuzzles(date);
    const storedPuzzles: StoredThemesPuzzle[] = puzzles.map(puzzle => ({
      ...puzzle,
      metadata: {
        createdAt: Date.now(),
        generatedBy: 'migration_script',
        version: '1.0',
        quality: {
          avgSimilarity: 0.5, // Calculate from actual data
          categoryBalance: 0.75,
          validated: false
        }
      }
    }));
    
    await storageService.storeDailyPuzzles(date, storedPuzzles);
  }
}
```

## Performance Considerations

### Indexing Strategy
- Use puzzle index for O(1) date existence checks
- Batch reads for multiple puzzles per date
- Cache frequently accessed dates in application memory

### Data Size Optimization
```typescript
// Compress puzzle data by separating metadata
interface CompactStoredPuzzle {
  id: string;
  puzzleNumber: number;
  categories: ThemeCategory[];
  words: string[];
  // Move metadata to separate storage if needed
}
```

### Firebase Query Optimization
```typescript
// Efficient date range queries using index
async getDateRange(startDate: string, endDate: string): Promise<string[]> {
  return this.dbClient.query(THEMES_DB_PATHS.PUZZLE_INDEX_ROOT())
    .orderByKey()
    .startAt(startDate)
    .endAt(endDate);
}
```

## Implementation Timeline

1. **Day 1-2**: Phase 1 - TypeScript interfaces and path constants
2. **Day 3-5**: Phase 2 - Storage service implementation and testing
3. **Day 4-6**: Phase 3 - Integration and migration utilities (parallel)

## Success Criteria
- ✅ Puzzles can be stored and retrieved efficiently
- ✅ Index provides fast date-based lookups
- ✅ Backward compatibility maintained
- ✅ Batch operations support bulk uploads
- ✅ Migration path from existing system

## Dependencies
- Database client interface (existing)
- TypeScript type system setup (existing)
- Firebase Realtime Database access (existing)

## Risk Mitigation
- Start with read-only operations to test schema
- Implement data validation for stored puzzles
- Use transactions for atomic puzzle + index updates
- Plan for schema evolution with version fields