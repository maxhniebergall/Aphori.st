# Remove Mock Data Systems - P1 Quality Fix

## Problem Summary
**Location**: Multiple files with mock data fallbacks  
**Issue**: System uses fake data instead of failing gracefully when vector system has issues  
**Impact**: Masks real problems and provides false confidence in results  
**Risk**: Production deployment could silently use mock data without operator knowledge

## Current Mock Data Systems Identified

### 1. Mock Word Generation
**Location**: `multiword_theme_generator.py:306-334`

```python
def _get_mock_words_for_theme(self, theme: str, puzzle_size: int) -> Optional[List[str]]:
    """Fallback mock word generation for when vector system fails"""
    mock_theme_words = {
        'animal': ['cat', 'dog', 'bird', 'fish', 'horse', 'cow', 'pig', 'sheep'],
        'color': ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'brown'],
        # ... more hardcoded words
    }
```

### 2. Mock Quality Scores  
**Location**: `multiword_theme_generator.py:547-550`

```python
except Exception as e:
    print(f"⚠️ Error calculating quality score: {e}")
    # Fallback to a reasonable default
    return 0.6 + random.uniform(-0.1, 0.1)  # ❌ FAKE RANDOM SCORE
```

### 3. Frequency Estimation Heuristics
**Location**: `multiword_theme_generator.py:134`

```python
# This is a simplification - in the actual system this would use real frequency data  
high_freq_threshold = min_frequency / 1000000  # ❌ ARBITRARY NORMALIZATION
```

## Implementation Plan - Can Be Done in Parallel

### Task Group A: Replace Mock Word Generation (Parallel Safe)
**File**: `scripts/datascience/themes_quality/scripts/multiword_theme_generator.py`

#### A1: Implement Proper Error Handling for Word Generation

```python
def get_category_words_for_theme(self, theme: str, puzzle_size: int = 4) -> Optional[List[str]]:
    """Get category words that match the given theme using real semantic similarity"""
    if not self.python_vector_loader:
        raise RuntimeError(
            f"Vector loader not available. Cannot generate words for theme '{theme}'. "
            f"Ensure vector data is loaded properly before running experiments."
        )
    
    try:
        # Extract the core theme word for multi-word themes
        core_theme = self._extract_core_theme_word(theme)
        
        # Find semantically similar words using the vector loader
        similar_words = self._find_similar_words_with_vectors(core_theme, puzzle_size + 10)
        
        if not similar_words:
            raise RuntimeError(
                f"No similar words found for theme '{theme}' (core: '{core_theme}'). "
                f"This may indicate the theme word is not in the vocabulary or "
                f"the vector similarity search failed."
            )
        
        # Filter and select best words
        filtered_words = self._filter_category_words(similar_words, puzzle_size)
        
        if len(filtered_words) < puzzle_size:
            raise RuntimeError(
                f"Insufficient quality words found for theme '{theme}': "
                f"found {len(filtered_words)}, needed {puzzle_size}. "
                f"Consider using a different theme or adjusting filtering criteria."
            )
        
        return filtered_words[:puzzle_size]
        
    except Exception as e:
        # Log the error and re-raise (no mock data fallback)
        print(f"❌ Failed to generate words for theme '{theme}': {e}")
        raise RuntimeError(f"Word generation failed for theme '{theme}': {e}") from e
```

#### A2: Remove Mock Data Method (Delete Entirely)

```python
# DELETE THIS ENTIRE METHOD - no replacement needed
def _get_mock_words_for_theme(self, theme: str, puzzle_size: int) -> Optional[List[str]]:
    # ... DELETE ALL OF THIS
```

### Task Group B: Replace Mock Quality Scores (Parallel Safe)
**File**: `scripts/datascience/themes_quality/scripts/multiword_theme_generator.py`

#### B1: Implement Proper Error Handling for Quality Calculation

```python
def _calculate_real_quality_score(self, puzzle: Dict[str, Any]) -> float:
    """Calculate real quality score using quality metrics system"""
    try:
        # Import quality metrics here to avoid circular imports
        from quality_metrics import QualityMetrics
        
        # Create quality calculator (will auto-initialize with vector loader)
        quality_calc = QualityMetrics()
        
        # Validate that quality calculator is properly initialized
        if not quality_calc.python_vector_loader and not quality_calc.vector_loader:
            raise RuntimeError(
                "Quality metrics calculator failed to initialize with vector loader. "
                "Cannot calculate meaningful quality scores without vector system."
            )
        
        # Calculate comprehensive quality metrics
        metrics = quality_calc.calculate_all_metrics(puzzle)
        
        # Validate results
        overall_score = metrics.get('overall_quality_score')
        if overall_score is None:
            raise RuntimeError("Quality calculation returned None for overall_quality_score")
        
        if not isinstance(overall_score, (int, float)) or overall_score < 0 or overall_score > 1:
            raise RuntimeError(f"Invalid quality score: {overall_score}. Expected float in [0,1].")
        
        return float(overall_score)
        
    except Exception as e:
        # Log error and re-raise (no random fallback)
        print(f"❌ Quality score calculation failed: {e}")
        raise RuntimeError(f"Quality calculation failed: {e}") from e
```

### Task Group C: Implement Real Frequency Data (Parallel Safe)
**File**: `scripts/datascience/themes_quality/scripts/multiword_theme_generator.py`

#### C1: Replace Frequency Estimation with Real Data

```python
def _get_random_word_by_frequency(self, min_frequency: float) -> Optional[str]:
    """Get a random word that meets the frequency threshold using real frequency data"""
    if not self.python_vector_loader:
        raise RuntimeError("Vector loader required for frequency-based word selection")
    
    try:
        # Check if we have actual frequency data available
        if hasattr(self.python_vector_loader, 'word_frequencies'):
            # Use real frequency data if available
            return self._select_word_by_real_frequency(min_frequency)
        else:
            # Use vocabulary ranking as frequency proxy (common approach)
            return self._select_word_by_vocabulary_ranking(min_frequency)
            
    except Exception as e:
        print(f"❌ Frequency-based word selection failed: {e}")
        raise RuntimeError(f"Could not select word by frequency: {e}") from e

def _select_word_by_vocabulary_ranking(self, min_frequency: float) -> Optional[str]:
    """Select word using vocabulary position as frequency proxy"""
    vocab_size = len(self.python_vector_loader.vocabulary)
    
    # Convert frequency threshold to vocabulary position
    # Higher frequency = lower index in sorted vocabulary
    # This assumes vocabulary is sorted by frequency (common practice)
    frequency_percentile = min(min_frequency / 10000000, 1.0)  # Scale to [0,1]
    max_index = int(vocab_size * (1 - frequency_percentile))
    
    if max_index <= 0:
        max_index = min(100, vocab_size)  # Fallback to top 100 words
    
    # Select random word from high-frequency portion
    selected_index = random.randint(0, max_index - 1)
    word = self.python_vector_loader.vocabulary[selected_index]
    
    print(f"   Selected word by ranking: {word} (index {selected_index}/{vocab_size})")
    return word
```

## Success Criteria

- [ ] No mock data methods remain in codebase
- [ ] System raises informative errors when vector system fails
- [ ] No random quality scores generated
- [ ] Real frequency data (or vocabulary ranking) used for word selection
- [ ] Error messages guide users to fix underlying issues
- [ ] No silent fallbacks that mask problems

## Files Modified

1. `scripts/datascience/themes_quality/scripts/multiword_theme_generator.py` 
   - Remove `_get_mock_words_for_theme` method (deletion)
   - Update `get_category_words_for_theme` (error handling)
   - Update `_calculate_real_quality_score` (error handling)  
   - Update `_get_random_word_by_frequency` (real data)

## Testing Commands

```bash
# Test proper error handling with missing vector data
cd /Users/mh/workplace/Aphori.st/scripts/datascience/themes_quality/scripts

# Test 1: Should raise RuntimeError when no vector loader
python -c "
from multiword_theme_generator import MultiWordThemeGenerator
gen = MultiWordThemeGenerator(vector_loader=None)  # Force no loader
try:
    gen.get_category_words_for_theme('animal', 4)
    print('❌ FAILED: Should have raised RuntimeError')
except RuntimeError as e:
    print('✅ SUCCESS: Proper error raised:', str(e))
"

# Test 2: Should work with proper vector loader  
python -c "
from multiword_theme_generator import MultiWordThemeGenerator
gen = MultiWordThemeGenerator()  # Auto-init vector loader
try:
    words = gen.get_category_words_for_theme('animal', 4)
    print('✅ SUCCESS: Real words generated:', words)
except RuntimeError as e:
    print('❌ Vector system issue:', str(e))
"
```

## Risk Assessment
- **Risk**: Medium - removing fallbacks could expose hidden issues
- **Impact**: Higher quality, more reliable results
- **Rollback**: Can restore mock systems if needed during development
- **Dependencies**: Requires vector system to be stable (validated as working)

## Implementation Notes

- **Parallel Execution**: All task groups (A, B, C) can be implemented simultaneously
- **No Sequential Dependencies**: Each group addresses different mock systems  
- **Error First Approach**: Implement proper error handling before removing mocks
- **Gradual Rollout**: Can implement one task group at a time for testing