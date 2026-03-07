# Benchmark Results — 2026-03-07

## Setup

- **Dataset**: webis-cmv-20 (Reddit r/ChangeMyView)
- **Task**: Rank delta-awarded replies highest
- **Threads evaluated**: 5 (t3_3qvldr, t3_6bejfv, t3_4gdj35, t3_5aceoz, t3_611uf5)
- **Metrics**: MRR (Mean Reciprocal Rank), Mean Rank, Median Rank
- **New this run**: HC variants — hinge centrality (betweenness) boost applied post-ranking to QE and DM

## Results (sorted by MRR)

| Algorithm | MRR | Mean Rank | Median Rank |
|---|---|---|---|
| EvidenceRank_Vote | **0.622** | 3.0 | 2 |
| EvidenceRank_Vote_NoBridge | 0.520 | 3.4 | 2 |
| Top | 0.517 | 2.4 | 2 |
| EvidenceRank_LLM | 0.479 | 3.2 | 2 |
| DampedModular_ReferenceBias_HC_NoBridge | 0.458 | 4.2 | 2 |
| QuadraticEnergy_LLM_HC | 0.457 | 3.8 | 2 |
| DampedModular_Vote_HC_NoBridge | 0.452 | 4.4 | 2 |
| EvidenceRank (production) | 0.420 | 4.0 | 1 |
| QuadraticEnergy_Vote_HC_NoBridge | 0.358 | 4.4 | 2 |
| QuadraticEnergy_Vote_HC | 0.357 | 4.0 | 2 |
| DampedModular_Vote_HC | 0.354 | 4.2 | 2 |
| DampedModular_ReferenceBias_HC | 0.354 | 4.2 | 2 |
| DampedModular_LLM_HC | 0.320 | 4.4 | 3 |
| EvidenceRank_LLM_NoBridge | 0.312 | 6.0 | 3 |
| QuadraticEnergy (production) | 0.289 | 4.3 | 3 |
| QuadraticEnergy_LLM_HC_NoBridge | 0.267 | 5.4 | 4 |
| DampedModular_LLM | 0.227 | 5.2 | 5 |
| QuadraticEnergy_Vote | 0.224 | 5.0 | 4 |
| DampedModular_ReferenceBias | 0.224 | 5.0 | 4 |
| DampedModular (baseline) | 0.220 | 5.2 | 4 |
| DampedModular_Vote | 0.220 | 5.2 | 4 |
| QuadraticEnergy_LLM | 0.214 | 5.2 | 5 |
| QuadraticEnergy_Vote_NoBridge | 0.192 | 6.4 | 7 |
| QuadraticEnergy_LLM_NoBridge | 0.192 | 10.0 | 12 |
| DampedModular_Vote_NoBridge | 0.165 | 6.8 | 7 |
| DampedModular_ReferenceBias_NoBridge | 0.165 | 6.8 | 7 |
| DampedModular_LLM_HC_NoBridge | 0.164 | 7.0 | 7 |
| DampedModular_LLM_NoBridge | 0.160 | 10.0 | 12 |

## Key Findings

### 1. Hinge centrality is the dominant signal for QE and DM

Without HC, QE and DM variants cluster at MRR 0.16–0.23. With HC applied, they jump to 0.32–0.46 — a lift of +0.13 to +0.24 MRR. The HC boost matters more than the choice of graph propagation algorithm (QE vs DM) or weight source (Vote vs LLM vs ReferenceBias).

### 2. EvidenceRank_Vote is the best single algorithm (0.622)

Raw CMV vote scores seed ER better than the nightly reference-bias weights. The CMV community upvotes delta-awarded replies heavily, making vote score a strong apriori signal. Production EvidenceRank (0.420) is weaker because the reference bias stage (source reputation from URLs/citations) adds noise rather than signal on this dataset.

### 3. Top baseline remains competitive (0.517)

Vote score alone — without any graph analysis — is close to the best algorithmic result. This is a CMV-specific property: the delta culture causes delta-awarded replies to accumulate upvotes, so raw Reddit score is already highly informative.

### 4. Bridge multiplier: mixed effect

Bridge helps for ER variants (+0.10 vs NoBridge). For QE/DM+HC, the NoBridge variants sometimes outperform (+HC_NoBridge > +HC for DM Vote and RefBias), suggesting the bridge multiplier may interact poorly with HC's betweenness boost — both reward connectivity, possibly double-counting.

### 5. LLM weight source helps QE more than DM

`QuadraticEnergy_LLM_HC` (0.457) is the best graph-only result. `DampedModular_LLM_HC` (0.320) lags behind `DampedModular_Vote_HC` (0.354), suggesting DM's modular influence function uses the weight differently from QE's logit formulation.

## Next Steps

- Run on a larger sample (50–100 threads) for statistically stable MRR estimates
- Investigate whether applying HC inside the nightly QE precomputation would improve the production `quadratic_energy` score (currently 0.289 without HC)
- Evaluate whether bridge and HC should be combined additively or only one applied
- Test whether `EvidenceRank_Vote` pattern (vote-seeded ER on thread-local graph) could replace the nightly reference-bias approach in production
