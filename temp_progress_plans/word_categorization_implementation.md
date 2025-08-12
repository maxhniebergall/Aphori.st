# Word Categorization Implementation

## Objective
Implement the core word categorization system using spaCy embeddings and dictionary cross-reference with parallel processing across 6 workers.

## Sequential Implementation Steps

### 1. Category Scoring System Setup
- Implement the three-strategy approach from appendix:
  - **Strategy 1**: Dictionary Cross-Reference (pragmatic baseline)
  - **Strategy 2**: Word Embeddings with spaCy (primary method)  
  - **Strategy 3**: LLM Analysis (for validation/edge cases)

### 2. spaCy Integration
- Load `en_core_web_md` model for embeddings
- Implement semantic similarity calculations
- Create category prototype vectors for each of 13 categories
- Handle out-of-vocabulary words gracefully

### 3. Dictionary Cross-Reference System
- Integrate dictionary lookup capabilities (PyDictionary or similar)
- Implement definition-based scoring
- Handle multiple word meanings and polysemy
- Create fallback mechanisms for missing definitions

### 4. Parallel Processing Architecture
- Design 6-worker multiprocessing system
- Implement work distribution across word batches
- Handle shared resources (spaCy model, dictionary)
- Implement progress tracking and error handling

### 5. Scoring Algorithm Implementation
- **Dictionary Definition Score** (0-1): Check for valid definitions
- **Semantic Embedding Score** (0-1): Measure category similarity
- **Combined Score** (0-1): Weighted combination with thresholds
- Support for multi-category assignment with confidence scores

## Implementation Details

### Core Scripts

#### `pipeline/word_categorizer.py`
```python
# Key functions:
- load_spacy_model()         # Load en_core_web_md
- create_category_prototypes() # Define category vectors
- process_word_batch()       # Worker function for parallel processing
- categorize_vocabulary()    # Main orchestration function
```

#### `pipeline/category_scorer.py`
```python
# Key functions:
- dictionary_score()         # Strategy 1: Dictionary lookup
- embedding_score()          # Strategy 2: spaCy similarity
- combined_score()           # Weighted combination
- assign_categories()        # Threshold-based assignment
```

### Category System (13 Categories)

**Implementation requires prototype definitions for:**
- `person` - Person names or personal identifiers
- `PersonType` - Job types, roles, professions
- `Location` - Geographic features, landmarks, places
- `LocationType` - Categories of locations
- `Organization` - Companies, groups, institutions
- `OrganizationType` - Types of organizations
- `Event` - Historical, social, natural events
- `EventType` - Categories of events
- `Product` - Physical objects, manufactured items
- `ProductType` - Categories of products
- `Creature` - Living beings, species, animals
- `Skill` - Capabilities, expertise, abilities
- `category` - Type descriptors, classifications

### Parallel Processing Configuration
- **Workers**: 6 CPU processes
- **Batch Size**: ~833 words per worker (5000/6)
- **Shared Resources**: spaCy model loaded once per worker
- **Communication**: Queue-based result collection
- **Error Handling**: Graceful degradation for failed words

### Scoring Thresholds
- **Minimum Confidence**: 0.3 (configurable)
- **High Confidence**: 0.7 (for automatic assignment)
- **Multi-category**: Words can belong to multiple categories
- **Validation Threshold**: 0.5 (for manual review)

## DVC Stage Definition
```yaml
categorize_words:
  cmd: python pipeline/word_categorizer.py
  deps:
    - pipeline/word_categorizer.py
    - pipeline/category_scorer.py
    - data/filtered_vocabulary.json
    - config/pipeline_config.yaml
  outs:
    - data/categorized_words.json
    - data/categorization_stats.json
  params:
    - word_categorization
    - scoring_thresholds
```

## Dependencies
- Vocabulary generation stage completion
- spaCy en_core_web_md model installation
- Dictionary lookup capability
- Multiprocessing support

## Validation Criteria
- All 5,000 words processed successfully
- Category assignments meet confidence thresholds
- Processing completes within reasonable time (parallel efficiency)
- Output includes confidence scores and metadata
- Statistical distribution of categories is reasonable

## Output Files
- `data/categorized_words.json` - Words with category assignments and scores
- `data/categorization_stats.json` - Processing statistics and distributions
- `data/validation_report.json` - Quality metrics and edge cases

## User Analysis Checkpoint
After categorization completes, user will analyze the categorized words before final vocabulary export. This allows for:
- Quality validation of category assignments
- Threshold adjustment if needed
- Manual review of edge cases
- Statistical analysis of category distributions