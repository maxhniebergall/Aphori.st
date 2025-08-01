# Themes Game - Vector/Database Integration Implementation Plan

## Phase 1: Existing Infrastructure Analysis (Sequential - Must Complete First)

### 1.1 Current VectorService Analysis

- **File**: Analysis of `backend/src/services/VectorService.ts`
- **Dependencies**: None (immediate analysis required)
- **Objectives**:
  - Understand current FAISS implementation patterns
  - Identify vector storage and indexing approaches
  - Document existing embedding generation workflow
  - Map current RTDB vector storage structure
  - Assess separation requirements for themes system

### 1.2 Current Database Client Analysis

- **File**: Analysis of existing database patterns
- **Dependencies**: None (immediate analysis required)
- **Objectives**:
  - Review current RTDB path conventions
  - Understand existing atomic operations and transactions
  - Document current database client usage patterns
  - Identify integration points for games data

## Phase 2: Themes-Specific Vector System (Sequential after Phase 1)

### 2.1 Isolated Themes Vector Index

- **File**: `backend/src/services/games/ThemesVectorService.ts`
- **Dependencies**: Phase 1 complete
- **Features**:
  - Completely separate FAISS index instance
  - Independent vector dimensionality and configuration
  - Isolated from main Aphorist search functionality
  - Custom similarity thresholds for game mechanics
  - Dedicated index persistence and loading

### 2.2 Themes Vector Storage Layer

- **File**: `backend/src/services/games/ThemesVectorStorage.ts`
- **Dependencies**: Phase 2.1 started
- **Features**:
  - Separate RTDB storage paths (`/themesVectorIndex/`)
  - Sharded storage system for themes word vectors
  - Independent from main vector storage shards
  - Optimized for game word retrieval patterns
  - Batch operations for puzzle generation

### 2.3 Themes Word Dataset Manager

- **File**: `backend/src/services/games/ThemesWordDataset.ts`
- **Dependencies**: Phase 2.1 started
- **Features**:
  - Curated word dataset loading and validation
  - Word preprocessing and filtering for game suitability
  - Category quality assessment
  - Embedding generation for game-specific words
  - Dataset versioning and updates

## Phase 3: Database Schema Extensions (Parallel with Phase 2)

### 3.1 Games Database Paths

- **File**: `backend/src/config/database/games.ts`
- **Dependencies**: Phase 1 complete
- **Features**:
  - Separate namespace for all games data
  - Daily puzzle storage structure
  - User progress tracking (logged-in and temporary)
  - Comprehensive attempt logging
  - Temporary user management

### 3.2 Games Database Operations

- **File**: `backend/src/database/games/ThemesDataOperations.ts`
- **Dependencies**: Phase 3.1 complete
- **Features**:
  - CRUD operations for puzzle data
  - User progress persistence and retrieval
  - Attempt logging with analytics support
  - Temporary user lifecycle management
  - Atomic operations for game state updates

### 3.3 Games Database Migrations

- **File**: `backend/src/migrations/games/createThemesSchema.ts`
- **Dependencies**: Phase 3.1 complete
- **Features**:
  - Initialize games database structure
  - Create required indexes and constraints
  - Set up temporary user cleanup triggers
  - Establish analytics data collection
  - Version control for schema changes

## Phase 4: Word Dataset Integration (Sequential after Phase 2.3)

### 4.1 Word Dataset Sources

- **Research Phase**: Identify suitable word datasets
- **Dependencies**: Phase 2.3 complete
- **Objectives**:
  - Evaluate public word datasets (WordNet, GloVe, etc.)
  - Assess word quality and game suitability
  - Determine licensing and usage requirements
  - Plan dataset size and scope

### 4.2 Word Dataset Processing Pipeline

- **File**: `backend/src/services/games/WordDatasetProcessor.ts`
- **Dependencies**: Phase 4.1 complete
- **Features**:
  - Word filtering and validation
  - Embedding generation using Vertex AI
  - Quality scoring for theme categorization
  - Batch processing for large datasets
  - Error handling and retry logic

### 4.3 Word Dataset Indexing

- **File**: `backend/src/services/games/WordIndexBuilder.ts`
- **Dependencies**: Phase 4.2 complete
- **Features**:
  - FAISS index construction for themes words
  - Similarity threshold calibration
  - Index validation and quality testing
  - Performance optimization for game queries
  - Index persistence and backup

## Phase 5: Vector Query Interface (Sequential after Phase 4)

### 5.1 Themes Similarity Search

- **File**: `backend/src/services/games/ThemesSimilaritySearch.ts`
- **Dependencies**: Phase 4 complete
- **Features**:
  - Nearest neighbor retrieval for puzzle generation
  - Category separation validation
  - Similarity scoring for game mechanics
  - Batch similarity queries for efficiency
  - Custom distance metrics for themes

### 5.2 Category Generation Engine

- **File**: `backend/src/services/games/CategoryGenerator.ts`
- **Dependencies**: Phase 5.1 complete
- **Features**:
  - Theme-based category creation using vector similarity
  - Category distinctiveness validation
  - Difficulty calibration based on similarity scores
  - Quality filtering and validation
  - Category balancing and optimization

### 5.3 Puzzle Quality Validator

- **File**: `backend/src/services/games/PuzzleQualityValidator.ts`
- **Dependencies**: Phase 5.2 complete
- **Features**:
  - Validate category separation quality
  - Assess puzzle difficulty consistency
  - Check for unintended word associations
  - Ensure appropriate challenge level
  - Generate quality metrics and reports

## Phase 6: Integration Testing & Optimization (Parallel with Phase 5)

### 6.1 Vector Performance Testing

- **File**: `backend/src/tests/games/vectorPerformance.test.ts`
- **Dependencies**: Phase 5.1 started
- **Features**:
  - Load testing for vector similarity queries
  - Performance benchmarking against requirements
  - Memory usage optimization
  - Query response time validation
  - Concurrent access testing

### 6.2 Database Performance Testing

- **File**: `backend/src/tests/games/databasePerformance.test.ts`
- **Dependencies**: Phase 3.2 complete
- **Features**:
  - RTDB operation performance testing
  - Concurrent user simulation
  - Data consistency validation
  - Transaction performance optimization
  - Storage efficiency assessment

### 6.3 End-to-End Integration Testing

- **File**: `backend/src/tests/games/e2eIntegration.test.ts`
- **Dependencies**: All previous phases started
- **Features**:
  - Complete puzzle generation workflow testing
  - User progress tracking validation
  - Attempt storage and retrieval testing
  - Cross-system integration validation
  - Error handling and recovery testing

## Implementation Details

### Vector System Isolation

#### Complete Separation Strategy

- **Separate FAISS Index**: Independent index instance with no shared state
- **Isolated Storage**: Dedicated RTDB paths with no overlap
- **Independent Configuration**: Separate parameters, thresholds, and settings
- **Dedicated Services**: No shared code with main vector search system
- **Isolated Dependencies**: Separate embedding generation pipeline

#### Data Flow Architecture

```text
Word Dataset → Processing → Embedding → FAISS Index → Similarity Search → Puzzle Generation
     ↓              ↓           ↓            ↓              ↓              ↓
RTDB Storage ← Index Storage ← Vector Storage ← Query Cache ← Categories ← Puzzles
```

### Database Schema Design

#### Games Namespace Structure

```text
/games/
  /themes/
    /daily/$date/
      /$puzzleId/
        - words: string[]
        - categories: Category[]
        - difficulty: number
        - created_at: timestamp
    /vectorIndex/
      /shards/$shardId/
        - vectors: number[][]
        - metadata: object[]
    /wordDataset/
      - words: string[]
      - embeddings_version: string
      - last_updated: timestamp

/userGameState/themes/$userId/
  - current_date: string
  - completed_puzzles: string[]
  - current_puzzle: number
  - total_attempts: number

/tempUserGameState/themes/$tempUserId/
  - (same structure as logged-in users)
  - created_at: timestamp
  - last_accessed: timestamp

/gameAttempts/themes/$userId/$date/$attemptId/
  - puzzle_id: string
  - selected_words: string[]
  - result: 'correct' | 'incorrect'
  - distance: number
  - timestamp: timestamp
  - user_type: 'logged_in' | 'temporary'

/tempUsers/$tempUserId/
  - created_at: timestamp
  - last_accessed: timestamp
  - expires_at: timestamp
```

### Performance Requirements

#### Vector Operations

- **Similarity Search**: < 50ms for nearest neighbor queries
- **Index Loading**: < 2 seconds on service startup
- **Embedding Generation**: < 100ms per word batch
- **Category Generation**: < 500ms for complete puzzle

#### Database Operations

- **Puzzle Retrieval**: < 100ms for daily puzzle set
- **Progress Updates**: < 50ms for user state changes
- **Attempt Logging**: < 25ms for submission recording
- **User Management**: < 30ms for temporary user operations

### Quality Metrics

#### Word Dataset Quality

- **Minimum Similarity**: 0.7 within categories
- **Maximum Cross-Category**: 0.4 between theme words
- **Word Diversity**: No more than 20% from single domain
- **Difficulty Distribution**: Balanced across puzzle sizes

#### Puzzle Quality

- **Category Distinctiveness**: Clear separation between themes
- **Appropriate Difficulty**: Calibrated for target audience
- **Word Familiarity**: Common vocabulary with some challenges
- **Theme Coherence**: Logical and intuitive connections

## Success Criteria

- ✅ Complete isolation from main Aphorist vector system
- ✅ Sub-50ms vector similarity queries for puzzle generation
- ✅ Support for 10,000+ curated game words
- ✅ Robust puzzle quality validation and scoring
- ✅ Efficient storage and retrieval of game data
- ✅ Comprehensive attempt logging for analytics
- ✅ Reliable temporary user management
- ✅ Scalable architecture for future game additions