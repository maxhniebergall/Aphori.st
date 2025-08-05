# Themes Game Word Quality Investigation

This directory contains the datascience investigation into word quality under different puzzle generation specifications.

## Structure

```
themes_quality/
├── README.md                          # This file
├── notebooks/                         # Jupyter notebooks for analysis
│   ├── 01_baseline_analysis.ipynb    # Current system baseline
│   ├── 02_parameter_sweeps.ipynb     # Parameter variation analysis
│   ├── 03_quality_assessment.ipynb   # Word quality evaluation
│   └── 04_optimization.ipynb         # Parameter optimization
├── data/                              # Generated data and results
│   ├── raw/                          # Raw puzzle generation data
│   ├── processed/                    # Cleaned and processed data
│   └── results/                      # Analysis results and figures
├── scripts/                          # Analysis and data collection scripts
│   ├── generate_parameter_sweep.py   # Parameter sweep generation
│   ├── quality_assessment.py         # Quality evaluation tools
│   └── performance_analysis.py       # Performance monitoring
├── config/                           # Configuration files
│   └── investigation_config.json     # Investigation parameters
└── reports/                          # Generated reports and documentation
    └── findings/                     # Investigation findings
```

## Quick Start

1. **Environment Setup**:
   ```bash
   cd scripts/datascience/themes_quality
   pip install jupyter pandas numpy matplotlib seaborn
   ```

2. **Start Investigation**:
   ```bash
   jupyter lab notebooks/01_baseline_analysis.ipynb
   ```

3. **Generate Test Data**:
   ```bash
   python scripts/generate_parameter_sweep.py
   ```

## Investigation Focus

- **Word Quality Analysis**: Distribution of word appropriateness across difficulty levels
- **Parameter Optimization**: Finding optimal frequency and similarity thresholds  
- **Algorithm Evaluation**: Comparing N=K vs alternative approaches
- **Performance Analysis**: Generation success rates and timing

## Key Metrics

- Word appropriateness scores (0-1 scale)
- Category coherence measures
- Generation success rates
- Performance benchmarks
- Quality control effectiveness