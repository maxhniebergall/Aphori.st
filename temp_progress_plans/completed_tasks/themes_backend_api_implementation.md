# Themes Game - Backend API Implementation Plan

## Phase 1: Database Schema & Models (Parallel Implementation)

### 1.1 Game State Data Models

- **File**: `backend/src/types/games/themes.ts`
- **Dependencies**: None (can start immediately)
- **Features**:
  - `ThemesPuzzle` interface (puzzle data, categories, words)
  - `ThemesGameState` interface (user progress, attempts, completed puzzles)
  - `ThemesAttempt` interface (selected words, result, timestamp, attempt_id)
  - `ThemesShareable` interface (emoji pattern, daily progress)
  - `TemporaryUserId` interface (temp_id, created_at, last_accessed)

### 1.2 Database Paths Configuration

- **File**: `backend/src/config/database/games.ts`
- **Dependencies**: None (can start immediately)
- **Features**:
  - RTDB path structure for games data
  - Daily puzzle storage paths (`/games/themes/daily/$date`)
  - User progress paths (`/userGameState/themes/$userId` and `/tempUserGameState/themes/$tempUserId`)
  - All attempt storage paths (`/gameAttempts/themes/$userId/$date/$attemptId`)
  - Temporary user management paths (`/tempUsers/$tempUserId`)
  - Puzzle generation cache paths

### 1.3 Temporary User Service

- **File**: `backend/src/services/games/TemporaryUserService.ts`
- **Dependencies**: None (can start immediately)
- **Features**:
  - Generate temporary user IDs (UUID format)
  - Cookie management for temporary users
  - 60-day expiration tracking and cleanup
  - Automatic ID renewal on access
  - Migration from temporary to permanent users

## Phase 2: Vector Service Modifications (Sequential - Requires Existing VectorService Analysis)

### 2.1 Separate Themes Vector Index

- **File**: `backend/src/services/games/ThemesVectorService.ts`
- **Dependencies**: Analysis of existing VectorService complete
- **Features**:
  - Completely separate FAISS index for themes words
  - Independent vector storage in RTDB (`/themesVectorIndex/`)
  - Dedicated word dataset loading and management
  - Isolated from main Aphorist vector search functionality

### 2.2 Themes Word Dataset Integration

- **File**: `backend/src/services/games/ThemesWordDataset.ts`
- **Dependencies**: Phase 2.1 started
- **Features**:
  - Load curated word dataset for themes game
  - Word preprocessing and filtering
  - Vector embedding generation for game words
  - Dataset validation and quality control

## Phase 3: Puzzle Generation Service (Sequential after Phase 2)

### 3.1 Themes Puzzle Generator

- **File**: `backend/src/services/games/ThemesPuzzleGenerator.ts`
- **Dependencies**: Phase 2 complete
- **Features**:
  - Daily puzzle generation algorithm using separate vector index
  - Vector similarity-based category creation
  - Puzzle difficulty scaling (4x4 → 10x10)
  - Category validation and balancing
  - Puzzle caching and persistence (permanent storage)

## Phase 4: API Endpoints (Sequential after Phase 3)

### 4.1 Daily Puzzles API

- **File**: `backend/src/routes/games/themes/dailyPuzzles.ts`
- **Dependencies**: Phase 3 complete
- **Endpoints**:
  - `GET /api/games/themes/daily/:date` - Get daily puzzle set
  - `GET /api/games/themes/daily/:date/:puzzleId` - Get specific puzzle
  - `POST /api/games/themes/generate-daily/:date` - Admin: generate daily puzzles

### 4.2 Game State API (Modified for Anonymous Users)

- **File**: `backend/src/routes/games/themes/gameState.ts`
- **Dependencies**: Phase 3 complete, Temporary User Service complete
- **Endpoints**:
  - `GET /api/games/themes/progress` - Get user progress (handles both logged-in and temporary users)
  - `POST /api/games/themes/attempt` - Submit puzzle attempt (stores ALL attempts permanently)
  - `GET /api/games/themes/shareable/:date` - Get shareable results
- **Features**:
  - Cookie-based temporary user identification
  - Automatic puzzle completion detection from attempts
  - Progress unlocking logic (sequential puzzle access)

### 4.3 Admin & Analytics API

- **File**: `backend/src/routes/games/themes/admin.ts`
- **Dependencies**: Phase 4.2 complete
- **Endpoints**:
  - `POST /api/games/themes/admin/regenerate/:date` - Regenerate daily puzzles
  - `GET /api/games/themes/admin/stats` - Game usage statistics
  - `GET /api/games/themes/admin/attempts/:date` - All attempts for analysis
  - `POST /api/games/themes/admin/validate-puzzles` - Validate puzzle quality

## Phase 5: Game Logic Services (Parallel with Phase 4)

### 5.1 Attempt Validation & Storage Service

- **File**: `backend/src/services/games/ThemesValidationService.ts`
- **Dependencies**: Phase 1 complete
- **Features**:
  - Validate submitted word selections
  - Calculate "distance" from correct theme (one away, two away)
  - Store every attempt permanently for analysis
  - Automatic puzzle completion detection
  - Success/failure determination and progress updates

### 5.2 Progress Tracking Service

- **File**: `backend/src/services/games/ThemesProgressService.ts`
- **Dependencies**: Phase 1 complete
- **Features**:
  - User progress persistence for both logged-in and temporary users
  - Daily puzzle unlocking logic (sequential completion)
  - Achievement tracking and statistics
  - Cross-session progress continuity

### 5.3 Shareable Generation Service

- **File**: `backend/src/services/games/ThemesShareableService.ts`
- **Dependencies**: Phase 5.1 complete
- **Features**:
  - Generate emoji patterns from stored attempt history
  - Create shareable text format (similar to NYT Connections)
  - Track sharing statistics
  - Social media optimization

## Phase 6: Background Jobs & Maintenance (Parallel Implementation)

### 6.1 Daily Puzzle Generation Job

- **File**: `backend/src/jobs/generateDailyThemesPuzzles.ts`
- **Dependencies**: Phase 3 complete
- **Features**:
  - Automated daily puzzle generation (cron job)
  - Quality validation and retry logic
  - Puzzle pre-generation and caching
  - Error handling and alerting

### 6.2 Temporary User Cleanup Job

- **File**: `backend/src/jobs/cleanupTempUsers.ts`
- **Dependencies**: Phase 1.3 complete
- **Features**:
  - Daily cleanup of expired temporary users (60+ days)
  - Archive user data before deletion
  - Performance monitoring and metrics
  - Error handling and recovery

### 6.3 Game Analytics Job

- **File**: `backend/src/jobs/themesAnalytics.ts`
- **Dependencies**: Phase 5 complete
- **Features**:
  - Daily usage statistics collection from stored attempts
  - Puzzle difficulty analytics
  - User engagement metrics
  - Performance monitoring

## Implementation Details

### Anonymous User Flow

1. **First Visit**: Generate temporary user ID, set 60-day cookie
2. **Subsequent Visits**: Read cookie, validate expiration, refresh if needed
3. **Expired Cookie**: Generate new temporary ID, start fresh progress
4. **User Registration**: Migrate temporary progress to permanent account

### Attempt Storage Strategy

- Store every submit action as permanent record
- Include attempt metadata: timestamp, user_id, puzzle_id, selected_words, result
- Enable comprehensive analytics and puzzle difficulty assessment
- Support replay and debugging capabilities

### Vector Service Isolation

- Complete separation from main Aphorist vector functionality
- Independent FAISS index with themes-specific word dataset
- Separate storage paths and management
- No cross-contamination with main search features

### Database Schema Extensions

```
/games/themes/daily/$date/$puzzleId -> puzzle data
/userGameState/themes/$userId -> logged-in user progress
/tempUserGameState/themes/$tempUserId -> temporary user progress
/gameAttempts/themes/$userId/$date/$attemptId -> all attempts
/tempUsers/$tempUserId -> temporary user metadata
/themesVectorIndex/ -> separate vector storage
```

## Success Criteria

- ✅ Handle anonymous users seamlessly with cookie-based tracking
- ✅ Store all attempts permanently for comprehensive analytics
- ✅ Maintain completely separate vector system from main site
- ✅ Generate valid daily puzzles automatically with permanent storage
- ✅ Handle 1000+ concurrent users (logged-in and anonymous)
- ✅ Sub-200ms API response times
- ✅ Robust temporary user management with proper cleanup
- ✅ Comprehensive logging and monitoring