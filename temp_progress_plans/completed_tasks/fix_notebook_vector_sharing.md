# Fix Notebook Vector Loader Sharing

**Priority**: CRITICAL  
**Status**: Ready to implement  
**Time Estimate**: ~30 minutes  
**Dependencies**: None - can start immediately  

## Problem Description

The multiword themes experiment notebook (`run_multiword_themes_experiment.ipynb`) fails because vector loaders are not properly shared between cells:

1. **Cell 1**: Successfully loads vectors into `QualityMetrics()` instance
2. **Cell 2**: Creates `MultiWordThemeGenerator(vector_loader=quality_calc.python_vector_loader)` ✅ (fixed)
3. **Cell 3**: Calls `run_multiword_theme_experiment()` which creates NEW `MultiWordThemeGenerator()` without vectors ❌
4. **Cell 4**: Creates NEW `QualityMetrics()` without vectors ❌

## Root Cause

Each cell creates fresh instances instead of reusing the successfully loaded vectors from Cell 1.

## Implementation Plan

### Sequential Steps (Must be done in order)

#### Step 1: Fix Cell 3 - Experiment Runner
**File**: `scripts/datascience/themes_quality/notebooks/run_multiword_themes_experiment.ipynb`  
**Cell**: `b3955d77` (Cell 3)

**Current code:**
```python
experiment_results = run_multiword_theme_experiment(num_theme_words, config)
```

**Fixed code:**
```python
# Pass the vector loader from Cell 1 to the experiment
experiment_results = run_multiword_theme_experiment(
    num_theme_words, 
    config, 
    vector_loader=quality_calc.python_vector_loader
)
```

#### Step 2: Fix Cell 4 - Quality Analysis
**File**: `scripts/datascience/themes_quality/notebooks/run_multiword_themes_experiment.ipynb`  
**Cell**: `6b717194` (Cell 4)

**Current code:**
```python
quality_calc = QualityMetrics()
```

**Fixed code:**
```python
# Reuse the existing QualityMetrics instance from Cell 1
# quality_calc is already available from Cell 1 - no need to create new instance
```

Remove the line that creates a new QualityMetrics instance entirely.

## Success Criteria

- Cell 3 passes `vector_loader` parameter to experiment function
- Cell 4 reuses existing `quality_calc` instance
- No new vector loader instances created after Cell 1
- Notebook maintains vector availability throughout all cells

## Risk Assessment

**Low Risk**: These are straightforward parameter passing fixes that don't change functionality, only fix broken state sharing.

## Testing

After implementation:
1. Run Cell 1 - should load vectors successfully
2. Run Cell 2 - should work with shared vectors  
3. Run Cell 3 - should work with passed vector loader
4. Run Cell 4 - should work with existing quality_calc instance

## Dependencies

- Must complete Step 2 from `update_experiment_function.md` in parallel
- Cannot test Cell 3 until the function signature is updated