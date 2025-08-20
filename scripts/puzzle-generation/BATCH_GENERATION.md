# Batch Generation System

This document describes the batch generation system for creating 100 4x4 puzzles using two different data science algorithms.

## Overview

The batch generation system creates two separate sets of 100 puzzles each using:
1. **Wiki Pipeline**: Basic vector similarity search on themes_index
2. **Gemini Pipeline**: Enhanced Gemini API embeddings for semantic similarity

## Scripts

### Individual Batch Generation
- `npm run generate:batch-wiki` - Generate 100 4x4 puzzles using wiki pipeline
- `npm run generate:batch-gemini` - Generate 100 4x4 puzzles using Gemini pipeline

### Combined Generation
- `npm run generate:all-batches` - Generate both sets and create comparison analysis

### Validation
- `npm run validate:batch` - Validate generated batches for 4x4 requirements

## Output Structure

```
batch-output/
├── set1-wiki-pipeline/
│   ├── puzzles.json          # Raw puzzle data
│   ├── metadata.json         # Generation metadata
│   ├── summary.json          # Algorithm summary
│   └── firebase-format.json  # Firebase-ready format
├── set2-gemini-pipeline/
│   ├── puzzles.json          # Raw puzzle data
│   ├── metadata.json         # Generation metadata
│   ├── summary.json          # Algorithm summary
│   └── firebase-format.json  # Firebase-ready format
├── unified-firebase-puzzles.json    # Combined Firebase format
├── wiki_firebase.json              # Wiki-only Firebase format
├── gemini_firebase.json            # Gemini-only Firebase format
├── firebase-conversion-summary.json # Conversion metadata
├── comparison-report.json          # Algorithm comparison
├── validation-report.json          # Quality validation results
└── batch-results.json             # Overall results summary
```

## Requirements

### Wiki Pipeline
- **Python 3**: Available as `python3` (installed ✅)
- **Python Dependencies**: `yaml`, `numpy`, `pandas`, etc.
  ```bash
  pip install pyyaml numpy pandas
  ```
- **Themes Index Data**: Vector data files in themes_index directory

### Gemini Pipeline  
- **DVC**: Data Version Control tool
  ```bash
  pip install dvc
  ```
- **Python Dependencies**: `google-genai` library
  ```bash
  pip install google-genai pyyaml numpy
  ```
- **API Key**: `GEMINI_API_KEY` environment variable
  ```bash
  export GEMINI_API_KEY="your-api-key-here"
  ```

### Current Status
- ✅ Firebase format conversion works with existing data
- ❌ Fresh pipeline execution requires dependency setup
- 📊 Existing puzzle data from previous runs is available

## Usage Examples

### Generate Both Sets
```bash
npm run generate:all-batches
```

### Generate Specific Set
```bash
npm run generate:batch-wiki ./output/wiki-set
npm run generate:batch-gemini ./output/gemini-set --verbose
```

### Validate Results
```bash
npm run validate:batch ./batch-output
```


## Quality Requirements

Each generated puzzle must meet:
- **Grid Size**: Exactly 4x4 (16 total words)
- **Categories**: Exactly 4 categories 
- **Words per Category**: Exactly 4 words each
- **Word Uniqueness**: No duplicate words
- **Non-empty Words**: All words must be valid strings

## Firebase Format

The unified Firebase format uses **named sets** instead of daily puzzles:

```json
{
  "puzzleSets": {
    "wiki_batch_2025-08-19": {
      "4x4": {
        "wiki_batch_2025-08-19_1": { /* puzzle data */ },
        "wiki_batch_2025-08-19_2": { /* puzzle data */ }
        // ... up to 100 puzzles
      }
    },
    "gemini_batch_2025-08-19": {
      "4x4": {
        "gemini_batch_2025-08-19_1": { /* puzzle data */ },
        "gemini_batch_2025-08-19_2": { /* puzzle data */ }
        // ... up to 100 puzzles
      }
    }
  },
  "setIndex": {
    "wiki_batch_2025-08-19": {
      "totalCount": 100,
      "algorithm": "wiki_puzzle_pipeline",
      "status": "active",
      "metadata": {
        "batchGenerated": true,
        "description": "Batch-generated 4x4 puzzles using wiki_puzzle_pipeline"
      }
    }
    // ... gemini set index
  }
}
```

### Firebase Upload
The `unified-firebase-puzzles.json` file is ready for direct upload to Firebase:
1. **Named Sets**: Each algorithm creates a named set (e.g., `wiki_batch_2025-08-19`)
2. **Set-based Access**: Puzzles are accessed by set name rather than date
3. **Algorithm Metadata**: Each set includes algorithm information and generation metadata
4. **4x4 Format**: Each puzzle has exactly 4 categories with 4 words each
5. **Set Index**: Efficient querying and management of puzzle sets

## Data Management

All batch output is tracked with DVC:
- `batch-output/` directory is added to `.gitignore`
- `batch-output.dvc` tracks the data in version control
- Use `dvc pull` to retrieve generated batches
- Firebase formats are included in DVC tracking

## Algorithms

### Wiki Pipeline
- Uses local vector similarity search
- Configurable similarity threshold (0.3 default)
- Random theme selection
- Fast generation, moderate quality

### Gemini Pipeline  
- Uses Gemini API embeddings
- Enhanced semantic similarity
- Theme-based word selection
- Slower generation, higher quality

## Troubleshooting

### Wiki Pipeline Issues
- Ensure themes_index data is available
- Check Python environment dependencies
- Verify vector loader initialization

### Gemini Pipeline Issues  
- Set `GEMINI_API_KEY` environment variable
- Install `google-genai` Python library
- Ensure DVC pipeline is configured

### Validation Failures
- Check puzzle format compliance
- Review algorithm output structure
- Validate word counts and categories