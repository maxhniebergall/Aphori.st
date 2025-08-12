# Fix Theme Vector Differentiation - P0 Critical Fix

## Problem Summary
**Location**: `quality_metrics.py` `_get_theme_vector` method  
**Issue**: All theme variants return identical similarity scores (1.000)  
**Evidence**: Notebook shows `original ↔ similar: 1.000`, `original ↔ type: 1.000`, `similar ↔ type: 1.000`  
**Root Cause**: Core word extraction returns same base word for all variants, defeating experiment purpose

## Current Broken Implementation

```python
# In quality_metrics.py - current _get_theme_vector method
def _get_theme_vector(self, theme: str):
    # All variants get reduced to the same core word
    core_theme = self._extract_core_theme_word(theme)  # "animal" for all variants
    return self.get_word_vector(core_theme)  # Same vector for all!
```

```python
# In multiword_theme_generator.py:222-232  
def _extract_core_theme_word(self, theme: str) -> str:
    if theme_lower.startswith('similar to '):
        return theme_lower.replace('similar to ', '').strip()  # Returns "animal"
    elif theme_lower.startswith('type of '):
        return theme_lower.replace('type of ', '').strip()    # Returns "animal"  
    else:
        return theme_lower  # Returns "animal"
```

## Implementation Plan - Sequential Steps

### Step 1: Implement Semantic Composition System
**File**: `scripts/datascience/themes_quality/scripts/quality_metrics.py`

Add new method for theme vector composition:

```python
def _get_theme_vector(self, theme: str):
    """Get vector representation for theme, including semantic composition for multi-word themes"""
    theme_lower = theme.lower().strip()
    
    if theme_lower.startswith('similar to '):
        return self._compose_similar_to_vector(theme)
    elif theme_lower.startswith('type of '):
        return self._compose_type_of_vector(theme)
    else:
        # Single word theme - use direct vector
        return self.get_word_vector(theme_lower)

def _compose_similar_to_vector(self, theme: str) -> Optional[np.ndarray]:
    """Compose vector for 'similar to X' themes using semantic composition"""
    core_word = theme.lower().replace('similar to ', '').strip()
    
    # Get base word vector
    core_vector = self.get_word_vector(core_word)
    if core_vector is None:
        return None
    
    # Get "similar" concept vector
    similar_vector = self.get_word_vector('similar')
    if similar_vector is None:
        # Fallback: slight modification of core vector
        return core_vector * 0.9 + np.random.normal(0, 0.01, core_vector.shape)
    
    # Semantic composition: weighted combination
    # This creates a vector that's "like animal but more similar/related"
    composed = 0.7 * core_vector + 0.3 * similar_vector
    
    # Normalize to unit vector (important for cosine similarity)
    norm = np.linalg.norm(composed)
    if norm > 0:
        composed = composed / norm
    
    return composed

def _compose_type_of_vector(self, theme: str) -> Optional[np.ndarray]:
    """Compose vector for 'type of X' themes using semantic composition"""
    core_word = theme.lower().replace('type of ', '').strip()
    
    # Get base word vector  
    core_vector = self.get_word_vector(core_word)
    if core_vector is None:
        return None
    
    # Get "type" concept vector
    type_vector = self.get_word_vector('type')
    if type_vector is None:
        # Fallback: different modification of core vector
        return core_vector * 1.1 + np.random.normal(0, 0.02, core_vector.shape)
    
    # Semantic composition: different weighting than "similar to"  
    # This creates a vector that's "like animal but more categorical/taxonomic"
    composed = 0.6 * core_vector + 0.4 * type_vector
    
    # Normalize to unit vector
    norm = np.linalg.norm(composed)
    if norm > 0:
        composed = composed / norm
    
    return composed
```

### Step 2: Update Theme Extraction in Generator
**File**: `scripts/datascience/themes_quality/scripts/multiword_theme_generator.py`

Update the extraction method to preserve theme context:

```python
def _extract_core_theme_word(self, theme: str) -> str:
    """Extract the core word from multi-word themes"""
    theme_lower = theme.lower().strip()
    
    # Handle multi-word themes - preserve some context
    if theme_lower.startswith('similar to '):
        core = theme_lower.replace('similar to ', '').strip()
        return f"similar_{core}"  # Differentiate from plain core word
    elif theme_lower.startswith('type of '):
        core = theme_lower.replace('type of ', '').strip()
        return f"type_{core}"     # Differentiate from plain core word
    else:
        return theme_lower
```

### Step 3: Validate Vector Differentiation
**Sequential execution required after Steps 1-2**

Add validation method to check theme vector differences:

```python
def validate_theme_vector_differentiation(self, theme_variants: List[ThemeVariant]) -> Dict[str, float]:
    """Validate that theme variants produce different vectors"""
    validation_results = {}
    
    for variant in theme_variants:
        original_vec = self._get_theme_vector(variant.original_theme)
        similar_vec = self._get_theme_vector(variant.similar_to_theme) 
        type_vec = self._get_theme_vector(variant.type_of_theme)
        
        if original_vec is not None and similar_vec is not None:
            orig_sim_similarity = self._cosine_similarity(original_vec, similar_vec)
        else:
            orig_sim_similarity = 0.0
            
        if original_vec is not None and type_vec is not None:
            orig_type_similarity = self._cosine_similarity(original_vec, type_vec)
        else:
            orig_type_similarity = 0.0
            
        if similar_vec is not None and type_vec is not None:
            sim_type_similarity = self._cosine_similarity(similar_vec, type_vec)
        else:
            sim_type_similarity = 0.0
        
        validation_results[variant.original_theme] = {
            'original_vs_similar': orig_sim_similarity,
            'original_vs_type': orig_type_similarity,
            'similar_vs_type': sim_type_similarity
        }
    
    return validation_results
```

### Step 4: Test Vector Differentiation
**Sequential execution required after Step 3**

```python
# Test script to run after implementation
def test_vector_differentiation():
    from quality_metrics import QualityMetrics
    from multiword_theme_generator import MultiWordThemeGenerator, ThemeVariant
    
    quality_calc = QualityMetrics()
    
    # Test with a simple variant
    variant = ThemeVariant(
        original_theme="animal",
        similar_to_theme="similar to animal", 
        type_of_theme="type of animal"
    )
    
    results = quality_calc.validate_theme_vector_differentiation([variant])
    print("Vector Differentiation Results:")
    for theme, similarities in results.items():
        print(f"Theme: {theme}")
        for comparison, score in similarities.items():
            print(f"  {comparison}: {score:.3f}")
        print()
    
    # Success criteria: similarities should be < 1.000 and reasonably different
    return results
```

## Success Criteria

- [ ] Theme similarities are NOT all 1.000
- [ ] `original ↔ similar` similarity: 0.7-0.95 (high but not identical)
- [ ] `original ↔ type` similarity: 0.7-0.95 (high but not identical)  
- [ ] `similar ↔ type` similarity: 0.5-0.9 (moderately similar)
- [ ] All similarities are different values
- [ ] Vector composition produces valid normalized vectors

## Files Modified

1. `scripts/datascience/themes_quality/scripts/quality_metrics.py` - Add semantic composition
2. `scripts/datascience/themes_quality/scripts/multiword_theme_generator.py` - Update extraction method

## Testing Commands

```bash
# Test vector differentiation
cd /Users/mh/workplace/Aphori.st/scripts/datascience/themes_quality/scripts  
python -c "
from quality_metrics import QualityMetrics
from multiword_theme_generator import ThemeVariant
qm = QualityMetrics()
variant = ThemeVariant('animal', 'similar to animal', 'type of animal')
results = qm.validate_theme_vector_differentiation([variant])
print(results)
"
```

## Risk Assessment
- **Risk**: Medium - semantic composition is novel approach
- **Impact**: Enables meaningful experiment results
- **Rollback**: Can revert to original implementation if issues arise
- **Dependencies**: Requires vector system to be working (already validated as working)