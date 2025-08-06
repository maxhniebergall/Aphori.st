# Local Puzzle Generation Scripts Implementation

## Overview
Create standalone scripts that generate high-quality puzzles using the full 2.9M word vector index and output JSON files ready for manual import into Firebase RTDB.

## Current Architecture Limitations
- Real-time generation uses only 20K filtered words from KNN service
- Limited processing time per request affects puzzle quality
- Cannot perform complex optimization during user requests

## Target Architecture Benefits
- Access to full 2.9M word vector database during generation
- Complex puzzle optimization and quality validation offline
- Manual review and curation before importing to production
- No backend complexity - simple JSON file output

## Implementation Plan

### Phase 1: Enhanced Local Vector Service (Foundation)

#### 1.1 Full Vector Index Loader
**New File:** `scripts/puzzle-generation/FullVectorLoader.ts`
```typescript
export class FullVectorLoader {
  private faissIndex: faiss.IndexFlatIP | null = null;
  private fullVocabulary: string[] = [];
  private wordVectors: Map<string, number[]> = new Map();

  async initialize(): Promise<void> {
    console.log('Loading full 2.9M word vector index...');
    
    // Load the original numpy files directly
    const vectorPath = 'scripts/datascience/word_vectors.npy';
    const vocabPath = 'scripts/datascience/word_vocab.json';
    
    await this.loadVectorIndex(vectorPath);
    await this.loadVocabulary(vocabPath);
    
    console.log(`Loaded ${this.fullVocabulary.length} words with vectors`);
  }

  async findNearestWithQuality(word: string, k: number): Promise<QualitySearchResult[]> {
    const neighbors = await this.findNearest(word, k * 3); // Get more candidates
    
    return neighbors
      .filter(neighbor => this.isWordSuitableForThemes(neighbor.word))
      .map(neighbor => ({
        ...neighbor,
        quality: this.calculateWordQuality(neighbor.word),
        thematicFit: this.calculateThematicFit(word, neighbor.word)
      }))
      .sort((a, b) => (b.quality * b.thematicFit) - (a.quality * a.thematicFit))
      .slice(0, k);
  }

  private isWordSuitableForThemes(word: string): boolean {
    // Filter for themes game suitability:
    // - Length between 3-12 characters
    // - No special characters or numbers
    // - Not proper nouns (basic check)
    // - Common English words
    return word.length >= 3 && 
           word.length <= 12 && 
           /^[a-z]+$/.test(word) && 
           !this.isProperNoun(word);
  }

  private calculateWordQuality(word: string): number {
    // Quality scoring based on:
    let score = 1.0;
    
    // Prefer common word lengths (4-8 letters)
    if (word.length >= 4 && word.length <= 8) score += 0.3;
    
    // Penalize very short or very long words
    if (word.length <= 3 || word.length >= 10) score -= 0.2;
    
    // Bonus for common letter patterns
    if (this.hasCommonPattern(word)) score += 0.1;
    
    return Math.max(0, Math.min(1, score));
  }

  getRandomSeedWord(): string {
    // Select high-quality seed words for category generation
    const suitableWords = this.fullVocabulary.filter(word => 
      this.isWordSuitableForThemes(word) && 
      this.calculateWordQuality(word) > 0.7
    );
    
    return suitableWords[Math.floor(Math.random() * suitableWords.length)];
  }
}
```

#### 1.2 Enhanced Puzzle Generator
**New File:** `scripts/puzzle-generation/HighQualityPuzzleGenerator.ts`
```typescript
export interface GeneratedPuzzleOutput {
  date: string;
  puzzles: GeneratedPuzzle[];
  metadata: {
    generatedAt: number;
    generatorVersion: string;
    totalAttempts: number;
    successRate: number;
    qualityScore: number;
    difficultyProgression: {
      puzzleSize: number;
      categoryDifficulties: number[];
      algorithmUsed: 'N=K+D';
    };
  };
}

export interface DifficultyMetrics {
  totalNeighbors: number;      // N value used
  discardedClosest: number;    // N-K neighbors discarded
  selectedRange: string;       // Range description like "2-5"
  puzzleSize: number;          // K value
  categoryDifficulty: number;  // D value
}

export class HighQualityPuzzleGenerator {
  constructor(private vectorLoader: FullVectorLoader) {}

  async generateDailyPuzzles(date: string, count: number = 3): Promise<GeneratedPuzzleOutput> {
    console.log(`Generating ${count} puzzles for ${date}...`);
    
    // Define puzzle configurations: [puzzleSize, expectedDifficulties]
    const puzzleConfigs = [
      { size: 4, name: '4x4 Standard' },  // N=5,6,7,8 (difficulties 1,2,3,4)
      { size: 4, name: '4x4 Advanced' }, // Second 4x4 with different seed words
      { size: 4, name: '4x4 Expert' }    // Third 4x4 with different seed words
    ];
    
    const puzzles: GeneratedPuzzle[] = [];
    let totalAttempts = 0;
    const qualityScores: number[] = [];

    for (let i = 0; i < Math.min(count, puzzleConfigs.length); i++) {
      const config = puzzleConfigs[i];
      const result = await this.generateSinglePuzzle(date, i + 1, config.size);
      
      if (result.puzzle) {
        puzzles.push(result.puzzle);
        qualityScores.push(result.qualityScore);
        
        // Log difficulty progression
        const difficulties = result.puzzle.categories.map(cat => cat.difficulty);
        console.log(`✅ Puzzle ${i + 1} (${config.name}): Generated in ${result.attempts} attempts`);
        console.log(`   Quality: ${result.qualityScore.toFixed(2)}, Difficulties: [${difficulties.join(', ')}]`);
      }
      
      totalAttempts += result.attempts;
    }

    return {
      date,
      puzzles,
      metadata: {
        generatedAt: Date.now(),
        generatorVersion: '1.0.0',
        totalAttempts,
        successRate: puzzles.length / count,
        qualityScore: qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length,
        difficultyProgression: {
          puzzleSize: 4, // Primary puzzle size
          categoryDifficulties: [1, 2, 3, 4], // Standard progression
          algorithmUsed: 'N=K+D'
        }
      }
    };
  }

  private async generateSinglePuzzle(date: string, puzzleNumber: number, puzzleSize: number = 4): Promise<GenerationResult> {
    const maxAttempts = 100;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const categories: GeneratedCategory[] = [];
      const usedWords = new Set<string>();
      let categoryAttempts = 0;

      // Generate categories with progressive difficulty using N = K + D algorithm
      for (let catIndex = 0; catIndex < puzzleSize; catIndex++) {
        const category = await this.generateCategory(usedWords, catIndex, puzzleSize);
        
        categoryAttempts++;
        
        if (category && this.validateCategory(category)) {
          categories.push(category);
          category.words.forEach(word => usedWords.add(word));
        } else {
          break; // Failed to generate valid category
        }
      }

      if (categories.length === puzzleSize) {
        const puzzle = this.assemblePuzzle(date, puzzleNumber, categories);
        const qualityScore = this.calculatePuzzleQuality(puzzle);
        
        if (qualityScore >= 0.5) { // Lowered quality threshold for automation
          return {
            puzzle,
            qualityScore,
            attempts: attempt
          };
        }
      }
    }

    console.log(`❌ Failed to generate puzzle ${puzzleNumber} after ${maxAttempts} attempts`);
    return {
      puzzle: null,
      qualityScore: 0,
      attempts: maxAttempts
    };
  }

  private async generateCategory(usedWords: Set<string>, categoryIndex: number, puzzleSize: number = 4): Promise<GeneratedCategory | null> {
    const maxAttempts = 20;
    
    // Progressive difficulty algorithm: N = K + D
    // Where K = puzzle size (4), D = difficulty (1-based category index)
    const K = puzzleSize;
    const D = categoryIndex + 1; // Convert 0-based index to 1-based difficulty
    const N = K + D; // Total neighbors to find
    
    console.log(`🎯 Generating category ${categoryIndex + 1}: K=${K}, D=${D}, N=${N} (finding ${N} neighbors, using ${K} furthest)`);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const seedWord = this.vectorLoader.getRandomSeedWord();
      if (usedWords.has(seedWord)) continue;

      // Find N nearest neighbors (more than we need)
      const allCandidates = await this.vectorLoader.findNearestWithQuality(seedWord, N + 5); // Extra for filtering
      const availableCandidates = allCandidates.filter(c => !usedWords.has(c.word));

      if (availableCandidates.length >= N) {
        // Apply progressive difficulty algorithm:
        // 1. Take N nearest neighbors
        // 2. Discard the N-K nearest (closest) neighbors
        // 3. Use the remaining K neighbors (furthest of the N)
        
        const nNearestNeighbors = availableCandidates.slice(0, N);
        const discardClosest = N - K; // Number of closest neighbors to discard
        const selectedCandidates = nNearestNeighbors.slice(discardClosest); // Take K furthest of N nearest
        
        if (selectedCandidates.length >= K) {
          const selectedWords = selectedCandidates.slice(0, K).map(c => c.word);

          console.log(`   ✅ Category ${categoryIndex + 1}: Using neighbors ranked ${discardClosest + 1}-${discardClosest + K} out of ${N}`);

          return {
            id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            themeWord: seedWord, // Seed word is the theme, not in puzzle
            words: selectedWords,
            difficulty: D,
            similarity: Math.min(...selectedCandidates.slice(0, K).map(c => c.similarity)),
            qualityMetrics: {
              avgQuality: selectedCandidates.slice(0, K).reduce((sum, c) => sum + c.quality, 0) / K,
              thematicCoherence: selectedCandidates.slice(0, K).reduce((sum, c) => sum + c.thematicFit, 0) / K,
              difficultyRank: {
                totalNeighbors: N,
                discardedClosest: discardClosest,
                selectedRange: `${discardClosest + 1}-${discardClosest + K}`
              }
            }
          };
        }
      }
    }

    console.log(`   ❌ Failed to generate category ${categoryIndex + 1} with difficulty N=${N}`);
    return null;
  }

  private assemblePuzzle(date: string, puzzleNumber: number, categories: GeneratedCategory[]): GeneratedPuzzle {
    const allWords = categories.flatMap(cat => cat.words);
    
    return {
      id: `themes_${date}_${puzzleNumber}`,
      date,
      puzzleNumber,
      gridSize: 4,
      difficulty: this.determineDifficulty(categories),
      categories: categories.map(cat => ({
        id: cat.id,
        themeWord: cat.themeWord,
        words: cat.words,
        difficulty: cat.difficulty,
        similarity: cat.similarity
      })),
      words: this.shuffleArray(allWords),
      metadata: {
        generatedAt: Date.now(),
        avgSimilarity: categories.reduce((sum, cat) => sum + cat.similarity, 0) / categories.length,
        qualityScore: categories.reduce((sum, cat) => sum + cat.qualityMetrics.avgQuality, 0) / categories.length
      }
    };
  }
}
```

### Phase 2: JSON Export Scripts (Sequential - After Phase 1)

#### 2.1 Main Generation Script
**New File:** `scripts/puzzle-generation/generate-puzzles.ts`
```typescript
#!/usr/bin/env node

interface GenerationConfig {
  startDate: string;
  endDate: string;
  puzzlesPerDay: number;
  outputDir: string;
  qualityThreshold: number;
}

export class PuzzleGenerationScript {
  constructor(
    private vectorLoader: FullVectorLoader,
    private puzzleGenerator: HighQualityPuzzleGenerator
  ) {}

  async generateDateRange(config: GenerationConfig): Promise<void> {
    console.log(`🎯 Generating puzzles from ${config.startDate} to ${config.endDate}`);
    console.log(`📊 ${config.puzzlesPerDay} puzzles per day, quality threshold: ${config.qualityThreshold}`);
    
    // Ensure output directory exists
    await this.ensureOutputDir(config.outputDir);
    
    const dates = this.generateDateRange(config.startDate, config.endDate);
    const results: GenerationSummary = {
      totalDates: dates.length,
      successfulDates: 0,
      totalPuzzles: 0,
      avgQuality: 0,
      failedDates: []
    };

    for (const date of dates) {
      try {
        const output = await this.puzzleGenerator.generateDailyPuzzles(date, config.puzzlesPerDay);
        
        if (output.puzzles.length > 0) {
          // Save to JSON file
          await this.saveToJSON(date, output, config.outputDir);
          
          results.successfulDates++;
          results.totalPuzzles += output.puzzles.length;
          results.avgQuality += output.metadata.qualityScore;
          
          console.log(`✅ ${date}: Generated ${output.puzzles.length}/${config.puzzlesPerDay} puzzles`);
        } else {
          results.failedDates.push(date);
          console.log(`❌ ${date}: Failed to generate puzzles`);
        }
      } catch (error) {
        results.failedDates.push(date);
        console.log(`💥 ${date}: Error - ${error.message}`);
      }
    }

    // Generate summary report
    await this.generateSummaryReport(results, config.outputDir);
    console.log(`\n📋 Summary: ${results.successfulDates}/${results.totalDates} dates successful`);
    console.log(`🎮 Total puzzles: ${results.totalPuzzles}`);
    console.log(`⭐ Average quality: ${(results.avgQuality / results.successfulDates).toFixed(2)}`);
  }

  private async saveToJSON(date: string, output: GeneratedPuzzleOutput, outputDir: string): Promise<void> {
    // Structure for Firebase import
    const firebaseData = {
      [`dailyPuzzles/themes/${date}`]: output.puzzles.reduce((acc, puzzle) => {
        acc[puzzle.id] = puzzle;
        return acc;
      }, {} as Record<string, any>),
      
      [`puzzleIndex/themes/${date}`]: {
        count: output.puzzles.length,
        lastUpdated: output.metadata.generatedAt,
        status: 'generated',
        puzzleIds: output.puzzles.map(p => p.id),
        metadata: output.metadata
      }
    };

    const filename = `${outputDir}/puzzles_${date}.json`;
    await fs.writeFile(filename, JSON.stringify(firebaseData, null, 2));
    
    console.log(`💾 Saved: ${filename}`);
  }

  private async generateSummaryReport(results: GenerationSummary, outputDir: string): Promise<void> {
    const report = {
      generatedAt: new Date().toISOString(),
      summary: results,
      importInstructions: {
        firebase: "Import each JSON file using Firebase Console > Realtime Database > Import JSON",
        structure: "Each file contains both puzzle data and index for a single date",
        validation: "Review puzzle quality before importing to production database"
      }
    };

    await fs.writeFile(`${outputDir}/generation_report.json`, JSON.stringify(report, null, 2));
  }
}

// CLI Interface
async function main() {
  const config: GenerationConfig = {
    startDate: process.argv[2] || '2025-08-05',
    endDate: process.argv[3] || '2025-08-11',
    puzzlesPerDay: parseInt(process.argv[4]) || 3,
    outputDir: process.argv[5] || './generated-puzzles',
    qualityThreshold: parseFloat(process.argv[6]) || 0.5
  };

  console.log('🚀 Initializing full vector service...');
  const vectorLoader = new FullVectorLoader();
  await vectorLoader.initialize();

  console.log('🎲 Starting puzzle generation...');
  const script = new PuzzleGenerationScript(
    vectorLoader,
    new HighQualityPuzzleGenerator(vectorLoader)
  );

  await script.generateDateRange(config);
  console.log('✨ Generation complete!');
}

if (require.main === module) {
  main().catch(console.error);
}
```

#### 2.2 Package and Usage
**New File:** `scripts/puzzle-generation/package.json`
```json
{
  "name": "themes-puzzle-generator",
  "version": "1.0.0",
  "description": "Local puzzle generation for themes game",
  "main": "generate-puzzles.js",
  "scripts": {
    "build": "tsc",
    "generate": "node dist/generate-puzzles.js",
    "generate-week": "npm run generate -- $(date +%Y-%m-%d) $(date -d '+7 days' +%Y-%m-%d) 3",
    "validate": "node dist/validate-puzzles.js"
  },
  "dependencies": {
    "faiss": "^1.0.0",
    "@types/node": "^18.0.0",
    "typescript": "^5.0.0"
  }
}
```

### Phase 3: Validation and Quality Tools (Parallel with Phase 2)

#### 3.1 Puzzle Validation Script
**New File:** `scripts/puzzle-generation/validate-puzzles.ts`
```typescript
export class PuzzleValidator {
  async validateGeneratedFiles(inputDir: string): Promise<ValidationReport> {
    const files = await fs.readdir(inputDir);
    const puzzleFiles = files.filter(f => f.startsWith('puzzles_') && f.endsWith('.json'));
    
    const report: ValidationReport = {
      totalFiles: puzzleFiles.length,
      validFiles: 0,
      issues: [],
      qualityStats: {
        avgQuality: 0,
        minQuality: 1,
        maxQuality: 0
      }
    };

    for (const file of puzzleFiles) {
      const validation = await this.validateFile(`${inputDir}/${file}`);
      
      if (validation.isValid) {
        report.validFiles++;
      } else {
        report.issues.push(...validation.issues);
      }
    }

    return report;
  }

  private async validateFile(filePath: string): Promise<FileValidation> {
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const issues: string[] = [];

    // Validate structure
    if (!data['dailyPuzzles/themes']) {
      issues.push(`Missing dailyPuzzles structure in ${filePath}`);
    }

    // Validate puzzles
    const puzzlePath = Object.keys(data).find(key => key.startsWith('dailyPuzzles/themes/'));
    if (puzzlePath) {
      const puzzles = Object.values(data[puzzlePath]);
      
      for (const puzzle of puzzles as any[]) {
        const puzzleIssues = this.validatePuzzle(puzzle);
        issues.push(...puzzleIssues);
      }
    }

    return {
      filePath,
      isValid: issues.length === 0,
      issues
    };
  }
}
```

## Progressive Difficulty Algorithm

### How N = K + D Works

For a 4x4 puzzle (K=4), the difficulty progression works as follows:

**Category 1 (D=1)**: N = 4 + 1 = 5
- Find 5 nearest neighbors of seed word
- Discard 1 closest neighbor (5-4=1)
- Use neighbors ranked 2-5 (slightly harder than closest)

**Category 2 (D=2)**: N = 4 + 2 = 6  
- Find 6 nearest neighbors of seed word
- Discard 2 closest neighbors (6-4=2)
- Use neighbors ranked 3-6 (moderately harder)

**Category 3 (D=3)**: N = 4 + 3 = 7
- Find 7 nearest neighbors of seed word  
- Discard 3 closest neighbors (7-4=3)
- Use neighbors ranked 4-7 (harder)

**Category 4 (D=4)**: N = 4 + 4 = 8
- Find 8 nearest neighbors of seed word
- Discard 4 closest neighbors (8-4=4)  
- Use neighbors ranked 5-8 (hardest)

### Example Output
```
🎯 Generating category 1: K=4, D=1, N=5 (finding 5 neighbors, using 4 furthest)
   ✅ Category 1: Using neighbors ranked 2-5 out of 5

🎯 Generating category 2: K=4, D=2, N=6 (finding 6 neighbors, using 4 furthest)  
   ✅ Category 2: Using neighbors ranked 3-6 out of 6

🎯 Generating category 3: K=4, D=3, N=7 (finding 7 neighbors, using 4 furthest)
   ✅ Category 3: Using neighbors ranked 4-7 out of 7

🎯 Generating category 4: K=4, D=4, N=8 (finding 8 neighbors, using 4 furthest)
   ✅ Category 4: Using neighbors ranked 5-8 out of 8
```

## Usage Examples

### Generate puzzles for next week
```bash
cd scripts/puzzle-generation
npm install
npm run build

# Generate puzzles (auto-upload with --upload flag)
npm run generate 2025-08-05 2025-08-11 3 ./output 0.5 --upload

# Or generate locally first, then upload  
npm run generate 2025-08-05 2025-08-11 3 ./output 0.5
npm run upload ./output

# Test difficulty algorithm with verbose logging
npm run generate 2025-08-05 2025-08-05 1 ./test 0.5 --verbose
```

### Output Structure
```
generated-puzzles/
├── puzzles_2025-08-05.json
├── puzzles_2025-08-06.json
├── puzzles_2025-08-07.json
├── ...
└── generation_report.json
```

## Implementation Timeline

1. **Week 1**: Phase 1 - Enhanced vector loader and puzzle generator
2. **Week 2**: Phase 2 - JSON export scripts and CLI tools
3. **Week 2**: Phase 3 - Validation tools (parallel)

## Success Criteria
- ✅ Generate high-quality puzzles using full 2.9M word vector index
- ✅ Output clean JSON files ready for Firebase import
- ✅ Quality validation and reporting tools
- ✅ Simple CLI interface for batch generation
- ✅ Clear documentation for manual import process

## Dependencies
- Full vector index access (scripts/datascience/word_vectors.npy)
- FAISS library for vector search
- Node.js/TypeScript runtime
- No backend dependencies - completely standalone

## Benefits
- ✅ **Simplicity**: No backend complexity, just generate and import
- ✅ **Quality**: Full vector index access for better puzzles  
- ✅ **Control**: Manual review before importing to production
- ✅ **Flexibility**: Generate puzzles on-demand or in batches
- ✅ **No Risk**: Existing system unchanged until manual import