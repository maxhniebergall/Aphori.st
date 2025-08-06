# Themes Puzzle Generator

Offline puzzle generation system that utilizes the full 2.9M word vector index to create high-quality themed word puzzles with progressive difficulty.

## Features

- **Full Vector Index Access**: Uses complete 2.9M word dataset for maximum vocabulary
- **Progressive Difficulty Algorithm (N=K+D)**: Implements scientific difficulty progression
- **Comprehensive Validation**: Structure validation and similarity scoring
- **Firebase-Ready Output**: Generates JSON files structured for direct Firebase import
- **Batch Generation**: Generate puzzles for date ranges efficiently
- **Detailed Reporting**: Generation statistics and algorithm metrics

## Algorithm: Progressive Difficulty (N = K + D)

For a 4x4 puzzle grid:
- **K** = puzzle size (4 words per category)
- **D** = difficulty level (1, 2, 3, 4 for categories)
- **N** = total neighbors to find (K + D)

### Category Difficulty Progression:

```
Category 1 (D=1): N=5 → Find 5 neighbors, use ranks 2-5 (discard closest)
Category 2 (D=2): N=6 → Find 6 neighbors, use ranks 3-6 (discard 2 closest)  
Category 3 (D=3): N=7 → Find 7 neighbors, use ranks 4-7 (discard 3 closest)
Category 4 (D=4): N=8 → Find 8 neighbors, use ranks 5-8 (discard 4 closest)
```

This creates natural difficulty progression where later categories use semantically more distant (harder) words.

## Installation

```bash
cd scripts/puzzle-generation
npm install
```

## Usage

### Generate Puzzles

```bash
# Generate puzzles for next week (3 per day, quality threshold 0.6)
npm run generate-week

# Generate puzzles for specific date range
npm run generate 2025-08-05 2025-08-11 3 0.6 ./output

# Generate test puzzle with verbose output
npm run generate-test

# Full syntax
npm run generate [startDate] [endDate] [puzzlesPerDay] [qualityThreshold] [outputDir] [maxAttempts] [--verbose]
```

### Validate Puzzles

```bash
# Validate generated puzzles
npm run validate ./generated-puzzles

# Validate with detailed output and save report
npm run validate ./output --verbose --report
```

### Development Workflow

```bash
# Generate test puzzle and validate (full development cycle)
npm run dev
```

## Examples

### Basic Generation
```bash
# Generate 3 puzzles for today with quality threshold 0.6
npm run generate $(date +%Y-%m-%d) $(date +%Y-%m-%d) 3 0.6

# Generate high-quality puzzles (stricter threshold)
npm run generate 2025-08-05 2025-08-07 3 0.8 ./high-quality
```

### Advanced Generation
```bash
# Generate with verbose logging and custom attempts
npm run generate 2025-08-05 2025-08-05 1 0.5 ./debug 20 --verbose

# Batch generation for month
npm run generate 2025-08-01 2025-08-31 3 0.6 ./monthly-puzzles
```

## Output Structure

```
generated-puzzles/
├── firebase_import.json       # Single file with all puzzles for Firebase import
└── generation_report.json     # Summary and quality metrics
```

### Firebase JSON Structure

The `firebase_import.json` file contains all puzzles in Firebase RTDB format:

```json
{
  "dailyPuzzles/themes/2025-08-05": {
    "themes_2025-08-05_1": { /* puzzle 1 data */ },
    "themes_2025-08-05_2": { /* puzzle 2 data */ },
    "themes_2025-08-05_3": { /* puzzle 3 data */ }
  },
  "dailyPuzzles/themes/2025-08-06": {
    "themes_2025-08-06_1": { /* puzzle 1 data */ },
    "themes_2025-08-06_2": { /* puzzle 2 data */ },
    "themes_2025-08-06_3": { /* puzzle 3 data */ }
  },
  "puzzleIndex/themes/2025-08-05": {
    "count": 3,
    "puzzleIds": ["themes_2025-08-05_1", "themes_2025-08-05_2", "themes_2025-08-05_3"],
    "qualityScore": 0.756,
    "metadata": { /* generation metadata */ }
  },
  "puzzleIndex/themes/2025-08-06": {
    "count": 3,
    "puzzleIds": ["themes_2025-08-06_1", "themes_2025-08-06_2", "themes_2025-08-06_3"],
    "qualityScore": 0.742,
    "metadata": { /* generation metadata */ }
  }
}
```

## Quality Metrics

### Quality Score Components:
- **Average Similarity (60%)**: Semantic coherence within categories
- **Difficulty Progression (30%)**: Proper 1→2→3→4 difficulty ordering
- **Word Diversity (10%)**: Length and letter variety across puzzle

### Quality Thresholds:
- **≥ 0.7**: Excellent - Ready for production
- **≥ 0.5**: Good - Recommended for use
- **≥ 0.3**: Fair - Review recommended
- **< 0.3**: Poor - Consider regeneration

## Firebase Import

1. Review generated puzzles using validation tool
2. Import the single JSON file via Firebase Console:
   - Navigate to Realtime Database
   - Click "⋮" menu → Import JSON
   - Select `firebase_import.json` file
   - Choose "Merge" option to add to existing data
3. Verify import by checking database structure matches expected paths

### Single File Benefits:
- **Atomic Import**: All puzzles imported in one operation
- **Consistency**: Ensures all dates are available simultaneously
- **Simplified Process**: One import instead of multiple files
- **Merge Capability**: Can add to existing database without conflicts

## Configuration

### Environment Variables
- `THEMES_VECTOR_DIMENSION`: Vector dimension (default: 300)
- `MAX_THEMES_INDEX_SIZE`: Memory limit for loaded vectors (default: 10000)

### Quality Thresholds
- Minimum recommended: 0.5
- Production recommended: 0.6
- High quality: 0.8+

## Troubleshooting

### Common Issues

1. **"Vector index files not found"**
   ```bash
   # Ensure themes index files exist
   ls scripts/datascience/themes_index/
   # Should contain: themes_vocabulary.json, themes_vectors.bin, themes_metadata.json
   ```

2. **"Failed to generate puzzles"**
   - Lower quality threshold (e.g., 0.4 instead of 0.6)
   - Increase max attempts per day
   - Check vector index loading

3. **"Low quality scores"**
   - Vector index may be limited
   - Try different date ranges
   - Review algorithm parameters

### Debugging

```bash
# Generate single puzzle with full debugging
npm run generate $(date +%Y-%m-%d) $(date +%Y-%m-%d) 1 0.3 ./debug 50 --verbose

# Validate generated puzzles
npm run validate ./debug --verbose --report
```

## Development

### Architecture
- **FullVectorLoader**: Loads complete 2.9M word vector index
- **HighQualityPuzzleGenerator**: Implements N=K+D difficulty algorithm
- **PuzzleValidator**: Validates structure and quality
- **CLI Scripts**: User-friendly command-line interface

### Adding Features
1. Extend `GeneratedCategory` interface for new metadata
2. Modify quality calculation in `calculatePuzzleQuality()`
3. Update validation rules in `validatePuzzle()`
4. Add new CLI options to `generate-puzzles.ts`

## Performance

- **Memory Usage**: ~300MB for full vector index
- **Generation Time**: ~30-60 seconds per date (3 puzzles)
- **Quality vs Speed**: Higher quality thresholds require more attempts

## License

MIT License - See project root for details