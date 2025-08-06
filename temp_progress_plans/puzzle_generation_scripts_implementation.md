# Offline Puzzle Generation Scripts Implementation

## Overview
Create standalone scripts for bulk puzzle generation that can utilize the full 2.9M word vector index, with quality validation and batch upload to Firebase.

## Current Limitations
- Real-time generation limited to 20K filtered words
- No quality optimization or manual curation
- Cannot perform expensive similarity calculations during user requests
- Limited puzzle diversity due to dataset constraints

## Target Capabilities
- Access full 2.9M word vector database for generation
- Advanced puzzle optimization algorithms
- Quality metrics and validation
- Batch generation for weeks/months of puzzles
- Manual curation and review workflow

## Implementation Plan

### Phase 1: Enhanced Vector Service (Foundation - Required First)

#### 1.1 Full Vector Index Service
**New File:** `scripts/puzzle-generation/FullVectorService.ts`
```typescript
export class FullVectorService {
  private faissIndex: faiss.IndexFlatIP | null = null;
  private fullVocabulary: string[] = [];
  private wordVectors: Map<string, number[]> = new Map();

  async initialize(): Promise<void> {
    // Load full 2.9M vector index (not just filtered 20K)
    await this.loadFullVectorIndex();
    await this.loadFullVocabulary();
  }

  async findNearestWithQuality(word: string, k: number): Promise<QualitySearchResult[]> {
    // Enhanced search with quality scoring
    const neighbors = await this.findNearest(word, k * 2); // Get more candidates
    
    return neighbors.map(neighbor => ({
      ...neighbor,
      quality: this.calculateWordQuality(neighbor.word),
      suitability: this.calculateSuitabilityScore(word, neighbor.word)
    })).sort((a, b) => b.quality * b.suitability - a.quality * a.suitability);
  }

  private calculateWordQuality(word: string): number {
    // Quality based on:
    // - Word length (prefer 4-8 letters)
    // - Common English word frequency
    // - Absence of special characters
    // - Not proper nouns
  }

  private calculateSuitabilityScore(seedWord: string, candidateWord: string): number {
    // Contextual suitability for themes game
    // - Semantic consistency
    // - Difficulty appropriateness
    // - Game balance considerations
  }
}
```

#### 1.2 Enhanced Puzzle Generator
**New File:** `scripts/puzzle-generation/AdvancedThemesPuzzleGenerator.ts`
```typescript
export class AdvancedThemesPuzzleGenerator {
  constructor(private vectorService: FullVectorService) {}

  async generateHighQualityPuzzle(targetDate: string, puzzleNumber: number): Promise<StoredThemesPuzzle | null> {
    const categories: ThemeCategory[] = [];
    const usedWords = new Set<string>();
    const maxAttempts = 100; // More attempts for better quality

    for (let categoryIndex = 0; categoryIndex < 4; categoryIndex++) {
      const category = await this.generateOptimizedCategory(usedWords, categoryIndex);
      if (!category) {
        continue; // Skip if can't generate quality category
      }
      
      // Validate category quality
      if (await this.validateCategoryQuality(category)) {
        categories.push(category);
        category.words.forEach(word => usedWords.add(word));
      }
    }

    if (categories.length < 4) {
      return null; // Only return puzzles with 4 complete categories
    }

    // Calculate overall puzzle quality
    const qualityMetrics = await this.calculatePuzzleQuality(categories);
    
    return {
      id: `themes_${targetDate}_${puzzleNumber}`,
      date: targetDate,
      puzzleNumber,
      gridSize: 4,
      difficulty: this.determineDifficulty(qualityMetrics),
      categories,
      words: categories.flatMap(cat => cat.words),
      metadata: {
        createdAt: Date.now(),
        generatedBy: 'advanced_generator_v1.0',
        version: '1.0',
        quality: qualityMetrics
      }
    };
  }

  private async generateOptimizedCategory(usedWords: Set<string>, categoryIndex: number): Promise<ThemeCategory | null> {
    const targetDifficulties = ['easy', 'medium', 'hard', 'expert']; // Progressive difficulty
    const targetDifficulty = targetDifficulties[categoryIndex];

    for (let attempt = 0; attempt < 50; attempt++) {
      const seedWord = await this.selectOptimalSeedWord(usedWords, targetDifficulty);
      if (!seedWord) continue;

      const candidates = await this.vectorService.findNearestWithQuality(seedWord, 20);
      const availableCandidates = candidates.filter(c => 
        !usedWords.has(c.word) && 
        this.isWordSuitableForDifficulty(c.word, targetDifficulty)
      );

      if (availableCandidates.length >= 4) {
        const selectedWords = availableCandidates.slice(0, 4).map(c => c.word);
        
        return {
          id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          themeWord: seedWord,
          words: selectedWords,
          difficulty: categoryIndex + 1,
          similarity: Math.min(...availableCandidates.slice(0, 4).map(c => c.similarity))
        };
      }
    }

    return null;
  }

  private async validateCategoryQuality(category: ThemeCategory): Promise<boolean> {
    // Advanced validation rules
    const checks = [
      this.checkWordLengthBalance(category.words),
      this.checkSemanticCoherence(category.words),
      this.checkDifficultyConsistency(category.words),
      this.checkGameBalance(category.words)
    ];

    return checks.every(check => check);
  }

  private async calculatePuzzleQuality(categories: ThemeCategory[]): Promise<PuzzleQualityMetrics> {
    const allWords = categories.flatMap(cat => cat.words);
    
    return {
      avgSimilarity: this.calculateAverageSimilarity(categories),
      categoryBalance: this.calculateCategoryBalance(categories),
      validated: false, // Requires manual validation
      wordDiversity: this.calculateWordDiversity(allWords),
      difficultyProgression: this.calculateDifficultyProgression(categories)
    };
  }
}
```

### Phase 2: Batch Generation Scripts (Sequential - After Phase 1)

#### 2.1 Daily Puzzle Generation Script
**New File:** `scripts/puzzle-generation/generate-daily-puzzles.ts`
```typescript
#!/usr/bin/env node

export interface GenerationConfig {
  startDate: string;
  endDate: string;
  puzzlesPerDay: number;
  qualityThreshold: number;
  maxAttemptsPerPuzzle: number;
  outputPath?: string;
  uploadToFirebase: boolean;
}

export class DailyPuzzleGenerator {
  constructor(
    private vectorService: FullVectorService,
    private puzzleGenerator: AdvancedThemesPuzzleGenerator,
    private storageService?: ThemesPuzzleStorageService
  ) {}

  async generateDateRange(config: GenerationConfig): Promise<GenerationResult> {
    const results: GenerationResult = {
      successful: {},
      failed: [],
      totalAttempted: 0,
      totalSuccessful: 0,
      qualityStats: {
        avgSimilarity: 0,
        avgBalance: 0,
        rejectionRate: 0
      }
    };

    const dates = this.generateDateRange(config.startDate, config.endDate);
    
    for (const date of dates) {
      console.log(`Generating puzzles for ${date}...`);
      
      const dayPuzzles: StoredThemesPuzzle[] = [];
      
      for (let puzzleNum = 1; puzzleNum <= config.puzzlesPerDay; puzzleNum++) {
        const puzzle = await this.generateSinglePuzzle(date, puzzleNum, config);
        if (puzzle) {
          dayPuzzles.push(puzzle);
        }
      }

      if (dayPuzzles.length > 0) {
        results.successful[date] = dayPuzzles;
        results.totalSuccessful += dayPuzzles.length;

        // Optional: Upload to Firebase
        if (config.uploadToFirebase && this.storageService) {
          await this.storageService.storeDailyPuzzles(date, dayPuzzles);
          console.log(`Uploaded ${dayPuzzles.length} puzzles for ${date}`);
        }

        // Optional: Save to file
        if (config.outputPath) {
          await this.savePuzzlesToFile(date, dayPuzzles, config.outputPath);
        }
      } else {
        results.failed.push(date);
      }

      results.totalAttempted += config.puzzlesPerDay;
    }

    return results;
  }

  private async generateSinglePuzzle(
    date: string, 
    puzzleNum: number, 
    config: GenerationConfig
  ): Promise<StoredThemesPuzzle | null> {
    
    for (let attempt = 0; attempt < config.maxAttemptsPerPuzzle; attempt++) {
      const puzzle = await this.puzzleGenerator.generateHighQualityPuzzle(date, puzzleNum);
      
      if (puzzle && this.meetsQualityThreshold(puzzle, config.qualityThreshold)) {
        console.log(`✅ Generated puzzle ${puzzleNum} for ${date} (attempt ${attempt + 1})`);
        return puzzle;
      }
    }

    console.log(`❌ Failed to generate puzzle ${puzzleNum} for ${date} after ${config.maxAttemptsPerPuzzle} attempts`);
    return null;
  }

  private meetsQualityThreshold(puzzle: StoredThemesPuzzle, threshold: number): boolean {
    const quality = puzzle.metadata.quality;
    const overallScore = (quality.avgSimilarity + quality.categoryBalance) / 2;
    return overallScore >= threshold;
  }
}

// CLI Interface
if (require.main === module) {
  const config: GenerationConfig = {
    startDate: process.argv[2] || '2025-08-05',
    endDate: process.argv[3] || '2025-08-11',
    puzzlesPerDay: parseInt(process.argv[4]) || 3,
    qualityThreshold: parseFloat(process.argv[5]) || 0.6,
    maxAttemptsPerPuzzle: parseInt(process.argv[6]) || 10,
    uploadToFirebase: process.argv.includes('--upload'),
    outputPath: process.argv.includes('--save') ? './generated-puzzles' : undefined
  };

  main(config).catch(console.error);
}

async function main(config: GenerationConfig) {
  console.log('Initializing full vector service...');
  const vectorService = new FullVectorService();
  await vectorService.initialize();

  console.log('Starting puzzle generation...');
  const generator = new DailyPuzzleGenerator(
    vectorService,
    new AdvancedThemesPuzzleGenerator(vectorService),
    config.uploadToFirebase ? new ThemesPuzzleStorageService(/* dbClient */) : undefined
  );

  const results = await generator.generateDateRange(config);
  
  console.log('\n📊 Generation Summary:');
  console.log(`Total attempted: ${results.totalAttempted}`);
  console.log(`Total successful: ${results.totalSuccessful}`);
  console.log(`Success rate: ${(results.totalSuccessful / results.totalAttempted * 100).toFixed(1)}%`);
  console.log(`Failed dates: ${results.failed.join(', ')}`);
}
```

#### 2.2 Quality Validation Script
**New File:** `scripts/puzzle-generation/validate-puzzles.ts`
```typescript
#!/usr/bin/env node

export class PuzzleQualityValidator {
  async validateStoredPuzzles(dates: string[]): Promise<ValidationReport> {
    const report: ValidationReport = {
      validatedPuzzles: 0,
      qualityIssues: [],
      recommendations: [],
      overallScore: 0
    };

    for (const date of dates) {
      const puzzles = await this.storageService.getDailyPuzzles(date);
      
      for (const puzzle of puzzles) {
        const validation = await this.validatePuzzle(puzzle);
        report.validatedPuzzles++;
        
        if (validation.issues.length > 0) {
          report.qualityIssues.push({
            puzzleId: puzzle.id,
            date,
            issues: validation.issues
          });
        }
      }
    }

    return report;
  }

  private async validatePuzzle(puzzle: StoredThemesPuzzle): Promise<PuzzleValidation> {
    const issues: string[] = [];
    
    // Word length validation
    const allWords = puzzle.words;
    if (allWords.some(word => word.length < 3 || word.length > 12)) {
      issues.push('Words outside optimal length range (3-12 characters)');
    }

    // Category coherence validation
    for (const category of puzzle.categories) {
      const coherenceScore = await this.calculateCategoryCoherence(category);
      if (coherenceScore < 0.5) {
        issues.push(`Low coherence in category: ${category.themeWord}`);
      }
    }

    // Difficulty progression
    const difficulties = puzzle.categories.map(cat => cat.difficulty);
    if (!this.hasGoodDifficultyProgression(difficulties)) {
      issues.push('Poor difficulty progression across categories');
    }

    return {
      puzzleId: puzzle.id,
      issues,
      qualityScore: this.calculateOverallQuality(puzzle),
      recommendations: this.generateRecommendations(issues)
    };
  }
}

// Usage
// npm run validate-puzzles 2025-08-05 2025-08-11
```

### Phase 3: Automation and Deployment (Parallel with Phase 2)

#### 3.1 Automated Generation Pipeline
**New File:** `scripts/puzzle-generation/automated-pipeline.ts`
```typescript
// Cron job or scheduled task for regular puzzle generation
export class AutomatedPuzzleGeneration {
  async generateUpcomingPuzzles(): Promise<void> {
    const today = new Date();
    const futureDate = new Date(today.getTime() + (7 * 24 * 60 * 60 * 1000)); // 1 week ahead
    
    const config: GenerationConfig = {
      startDate: this.formatDate(today),
      endDate: this.formatDate(futureDate),
      puzzlesPerDay: 3,
      qualityThreshold: 0.65,
      maxAttemptsPerPuzzle: 20,
      uploadToFirebase: true
    };

    await this.runGeneration(config);
  }

  async backfillMissingPuzzles(): Promise<void> {
    // Check for missing puzzle dates and generate them
    const availableDates = await this.storageService.getAvailableDates();
    const requiredDates = this.generateDateRange(
      '2025-08-01', 
      this.formatDate(new Date())
    );
    
    const missingDates = requiredDates.filter(date => !availableDates.includes(date));
    
    if (missingDates.length > 0) {
      console.log(`Backfilling ${missingDates.length} missing dates...`);
      // Generate for missing dates
    }
  }
}
```

#### 3.2 Docker Integration
**New File:** `scripts/puzzle-generation/Dockerfile`
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy full vector data
COPY scripts/datascience/word_vectors.npy ./
COPY scripts/datascience/word_vocab.json ./

# Copy generation scripts
COPY scripts/puzzle-generation/ ./generation/

# Install dependencies
RUN npm install

# Default command
CMD ["node", "generation/generate-daily-puzzles.js"]
```

## Implementation Timeline

1. **Week 1**: Phase 1 - Enhanced vector service and puzzle generator
2. **Week 2**: Phase 2 - Batch generation scripts and validation tools
3. **Week 2**: Phase 3 - Automation and deployment setup (parallel)

## Usage Examples

### Manual Generation
```bash
# Generate puzzles for next week
npm run generate-puzzles 2025-08-05 2025-08-11 3 0.6 --upload

# Validate existing puzzles
npm run validate-puzzles 2025-08-01 2025-08-31

# Backfill missing dates
npm run backfill-puzzles
```

### Automated Pipeline
```bash
# Daily cron job
0 2 * * * cd /app && npm run auto-generate
```

## Success Criteria
- ✅ Generate high-quality puzzles using full vector index
- ✅ Batch upload weeks of puzzles efficiently
- ✅ Quality validation and metrics reporting
- ✅ Automated pipeline for continuous generation
- ✅ Manual curation workflow for quality control

## Dependencies
- Full vector index access (2.9M words)
- Firebase storage schema implementation
- Enhanced TypeScript interfaces
- Docker environment for isolation

## Risk Mitigation
- Generate extra puzzles for manual curation selection
- Implement rollback mechanism for low-quality batches
- Maintain fallback to real-time generation
- Quality threshold validation before upload
- Manual approval workflow for published puzzles