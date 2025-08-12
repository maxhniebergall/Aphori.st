# NLP Pipeline Implementation Plan

## Overview
Implementation of a new modular NLP pipeline for puzzle generation using DVC (Data Version Control) with parallel processing across 6 CPU workers. The pipeline creates categorized vocabularies using spaCy text embeddings, NLTK word corpus, and dictionary cross-reference validation.

## Immediate Actions

### 1. Pipeline Infrastructure Setup
- **Status**: Ready to implement
- **Dependencies**: None
- **Timeline**: 1 day
- **Files**: `dvc_pipeline_setup.md`

### 2. Vocabulary Generation Stage  
- **Status**: Ready to implement
- **Dependencies**: Pipeline infrastructure
- **Timeline**: 1 day
- **Files**: `vocabulary_generation_implementation.md`

### 3. Word Categorization System
- **Status**: Ready to implement  
- **Dependencies**: Vocabulary generation
- **Timeline**: 2 days
- **Files**: `word_categorization_implementation.md`

### 4. Vocabulary Export
- **Status**: Ready to implement
- **Dependencies**: Word categorization
- **Timeline**: 0.5 days
- **Files**: `vocabulary_export_implementation.md`

## Sequential Dependencies

1. **Pipeline Infrastructure** → **Vocabulary Generation** → **Word Categorization** → **Vocabulary Export**

## Parallel Implementation Opportunities

- Word categorization can process multiple categories in parallel using 6 workers
- Manual quality assessment will be performed by user after export
- Documentation can be written alongside implementation

## Detailed Strategy

### Core Technologies
- **DVC**: Data pipeline orchestration and versioning
- **spaCy**: Text embeddings and NLP processing (en_core_web_md model required)
- **NLTK**: Word corpus (`words` dataset) and linguistic utilities
- **Python**: Core processing with multiprocessing support (6 workers)

### Pipeline Stages

1. **Vocabulary Creation** using NLTK `words` dataset and unigram frequency data
   - Load word frequencies from `data/unigram_freq.csv`
   - Filter to top 5,000 words by frequency
   - Export filtered vocabulary for categorization

2. **Word Categorization** using spaCy embeddings + dictionary cross-reference
   - Create scores by checking dictionary definitions
   - Use semantic embeddings for category likelihood
   - Process with 6 parallel workers
   - Words can be added to multiple categories if they meet the threshold

3. **Category Export** to separate vocabulary files in `data/vocabs/`

### Complete Category System (13 categories)

**Entity Categories:**
- `person` - Words likely to be person names or unlikely to fit other categories
- `PersonType` - Job types or roles held by a person
- `Location` - Natural and human-made landmarks, structures, geographical features, geopolitical entities
- `LocationType` - Categories of location types
- `Organization` - Companies, political groups, musical bands, sport clubs, government bodies, public organizations
- `OrganizationType` - Categories of organizations
- `Event` - Historical, social, and naturally occurring events
- `EventType` - Categories of events
- `Product` - Physical objects of various types
- `ProductType` - Categories of products
- `Creature` - Living creatures (real or fictional), species, or common names
- `Skill` - Capabilities, skills, or expertise
- `category` - Words describing types of things (e.g., biology family/genus)

### Scoring Algorithm Details

Each word receives scores for category assignment based on:

1. **Dictionary Definition Check** - Verify word has valid dictionary definitions
2. **Semantic Embedding Analysis** - Use spaCy embeddings to measure category likelihood
3. **Combined Confidence Score** - Weighted combination for category assignment

Implementation follows the three strategies outlined in appendix:
- Strategy 1: Dictionary Cross-Reference (pragmatic baseline)
- Strategy 2: Word Embeddings with spaCy (primary method)
- Strategy 3: LLM Analysis (for edge cases/validation)

### Data Flow
```
NLTK Words Dataset (full corpus) + Unigram Frequency Data
        ↓
[Filter by Frequency - Top 5,000]
        ↓
Filtered Vocabulary
        ↓
[Parallel Processing: 6 Workers]
        ↓
Word → [spaCy Embeddings] → [Dictionary Lookup] → [Category Scoring]
        ↓
13 Categorized Word Lists
        ↓
[Export to Vocabulary Files]
        ↓
scripts/datascience/themes_quality/data/vocabs/
├── person.json
├── person_type.json
├── location.json
├── location_type.json
├── organization.json
├── organization_type.json
├── event.json
├── event_type.json
├── product.json
├── product_type.json
├── creature.json
├── skill.json
└── category.json
```

### Integration Points

- Existing puzzle generation system in `scripts/puzzle-generation/`
- Current themes quality assessment in `scripts/datascience/themes_quality/`
- Vector search system integration
- DVC pipeline integration with existing `dvc.yaml`

### User Analysis Checkpoints

1. **After Vocabulary Generation**: User will analyze the filtered 5,000 words before categorization
2. **After Vocabulary Export**: User will manually perform quality assessment of the 13 categorized vocabulary files before proceeding to integration phases