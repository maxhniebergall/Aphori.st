# Predictor Analysis: I-Node Count vs Child Reply Count

## Thesis

The number of arguments *within* a reply (i-node count) is a better predictor of persuasiveness than the number of responses *to* it (child reply count).

## Dataset

- **Threads**: 206 (webis-cmv-20, Reddit r/ChangeMyView)
- **Total replies**: 6,096
- **Delta replies**: 360 (5.9%)

## Descriptive Statistics

| Metric | Delta replies | Non-delta replies |
|---|---|---|
| I-node count | 5.04 ± 2.02 | 3.37 ± 1.83 |
| Child replies | 5.76 ± 5.31 | 3.17 ± 3.42 |

Delta replies have ~50% more i-nodes and ~80% more child replies than non-deltas. However, child reply count has much higher variance (std 5.31 vs 2.02), making it a noisier signal.

## Results

| Metric | I-node count | Child reply count | Ratio |
|---|---|---|---|
| Cohen's d | 0.905 (large) | 0.725 (medium) | 1.25x |
| Point-biserial r | 0.207 (p=5e-60) | 0.167 (p=2e-39) | 1.24x |
| Rank-biserial r | 0.473 | 0.384 | 1.23x |
| ROC AUC | 0.736 | 0.692 | 1.06x |
| Logistic regression beta | 0.609 | 0.242 | 2.52x |

All tests use the full dataset of 6,096 replies across 206 threads.

## Interpretation

- **Cohen's d**: I-node count shows a *large* effect (d > 0.8) while child reply count shows a *medium* effect (d < 0.8). Delta replies are nearly a full standard deviation above non-deltas in argument count.

- **Point-biserial correlation**: Both predictors are highly significant (p < 1e-34), but i-node count has 20 additional orders of magnitude of significance (5e-60 vs 2e-39), indicating a more reliable association.

- **ROC AUC**: I-node count alone achieves 0.736 discriminative ability — knowing only how many claims a reply makes, you can correctly rank a random delta reply above a random non-delta reply 73.6% of the time.

- **Logistic regression**: When both predictors are available simultaneously (standardized), i-node count has 2.5x the coefficient of child reply count. The argument count signal dominates; child reply count adds marginal information.

## Why This Matters

This result validates the core mechanism behind ER_Vote_Sum_NoDC_Bridge (MRR 0.590, best algorithm). Sum aggregation works because it captures the i-node count signal — replies with more extracted claims score higher. The ML argument extraction pipeline produces a feature (claim count) that is more predictive than a purely structural feature (response count) available without any NLP.

Persuasive replies in CMV tend to be substantive, multi-point rebuttals that address several facets of the OP's view. Each facet generates extractable claims. Replies that provoke many responses, by contrast, may simply be controversial or emotionally charged — engagement does not imply persuasion.
