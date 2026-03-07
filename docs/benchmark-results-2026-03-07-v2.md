# Benchmark Results — 2026-03-07 v2 (20-thread run)

## Setup

- **Dataset**: webis-cmv-20 (Reddit r/ChangeMyView)
- **Task**: Rank delta-awarded replies highest
- **Threads evaluated**: 20 (new threads, excluding all previously tested)
- **Metrics**: MRR (Mean Reciprocal Rank), Mean Rank ±Std Dev, Median Rank
- **New this run**: `rank_std` (standard deviation of rank) added to all metrics; QE_LLM bug fixed (see below)

## Results (sorted by MRR)

| Algorithm | MRR | Mean Rank | ±Std | Median Rank |
|---|---|---|---|---|
| EvidenceRank_Vote | **0.568** | 3.5 | ±3.6 | 2.0 |
| EvidenceRank_Vote_NoBridge | 0.548 | 3.4 | ±3.3 | 2.0 |
| Top | 0.502 | 7.7 | ±13.2 | 2.0 |
| EvidenceRank_LLM_NoBridge | 0.399 | 7.8 | ±12.0 | 3.0 |
| EvidenceRank_LLM | 0.397 | 9.0 | ±13.0 | 5.0 |
| DampedModular_LLM | 0.392 | 14.3 | ±17.9 | 4.0 |
| QuadraticEnergy_Vote *(bugged QE_LLM = same)* | 0.368 | 6.6 | ±6.2 | 4.5 |
| QuadraticEnergy_Vote_NoBridge *(bugged QE_LLM_NoBridge = same)* | 0.366 | 5.2 | ±3.9 | 4.0 |
| DampedModular_ReferenceBias_NoBridge | 0.354 | 6.3 | ±5.6 | 4.5 |
| DampedModular_Vote_HC_NoBridge | 0.351 | 6.5 | ±5.9 | 4.0 |
| DampedModular_Vote_NoBridge | 0.349 | 7.2 | ±7.2 | 4.0 |
| DampedModular / DampedModular_Vote | 0.338 | 9.0 | ±11.0 | 3.0 |
| DampedModular_Vote_HC | 0.338 | 7.8 | ±7.2 | 4.5 |
| DampedModular_LLM_NoBridge | 0.336 | 13.8 | ±16.3 | 6.5 |
| DampedModular_LLM_HC | 0.333 | 10.9 | ±12.4 | 4.5 |
| DampedModular_ReferenceBias | 0.326 | 8.2 | ±8.5 | 4.0 |
| DampedModular_ReferenceBias_HC | 0.318 | 6.9 | ±6.0 | 4.5 |
| DampedModular_ReferenceBias_HC_NoBridge | 0.312 | 6.2 | ±4.8 | 4.5 |
| DampedModular_LLM_HC_NoBridge | 0.308 | 10.0 | ±10.7 | 8.5 |
| EvidenceRank (production) | 0.173 | 2.4 | ±1.7 | 1.0 |
| QuadraticEnergy (production) | 0.152 | 2.4 | ±1.5 | 2.0 |

## Bug Found and Fixed: QE_LLM Weight Source

`QuadraticEnergy_Vote` and `QuadraticEnergy_LLM` produced identical results (MRR 0.368, same mean/median). Root cause: `makeNodesQE()` was setting the LLM score as `basic_strength`, but `QuadraticEnergyStrategy` Phase 1 reads `vote_score` for its log-scaled prior and ignores `basic_strength` entirely. Both variants therefore used the same raw CMV vote score as the prior.

**Fix**: `makeNodesQE` now routes the weight source through `vote_score`, and a separate `makeNodesDM` routes it through `basic_strength` (which DM actually uses). The QE_LLM results in this table are therefore invalid — a corrected rerun is needed to get accurate QE_LLM numbers.

## Key Findings (20-thread sample)

### 1. EvidenceRank_Vote remains the clear winner (0.568 MRR)

Consistent with the 5-thread run (0.622). The CMV vote score is a strong apriori signal because the community upvotes delta-awarded replies. ER then amplifies this via the evidence/bridge aggregation. Bridge helps (+0.02 vs NoBridge), which is consistent with the 5-thread result.

### 2. Top baseline remains highly competitive (0.502)

Sorting by raw vote score alone nearly matches EvidenceRank_Vote, confirming that vote score is the dominant signal on CMV. The gap is only 0.066 MRR — graph analysis adds modest but real value.

### 3. HC effect reversal vs. 5-thread run

The 5-thread run showed HC as the dominant signal for QE/DM (+0.13–0.24 MRR lift). On 20 threads, HC variants show no clear improvement over non-HC variants within DM (DampedModular_Vote_HC = 0.338 vs DampedModular_Vote_NoBridge = 0.349). The 5-thread HC result was likely noise from the small sample.

### 4. High variance in DM and Top

- **Top**: mean 7.7 ±13.2 vs median 2.0 — heavy right-tail, likely one thread with many replies where the delta reply got low votes
- **DampedModular_LLM**: mean 14.3 ±17.9 vs median 4.0 — LLM weight source is unstable in DM; possible over-weighting of short/non-persuasive replies
- **EvidenceRank_Vote**: mean 3.5 ±3.6 — much tighter distribution, most reliable

### 5. Production baselines remain far behind

EvidenceRank (prod) = 0.173, QuadraticEnergy (prod) = 0.152. Both use the nightly-computed reference-bias weights (source reputation from URLs/citations), which appear to add noise rather than signal on the CMV dataset where persuasive rhetoric, not citation quality, earns deltas.

### 6. DM NoBridge consistently better than DM+Bridge

Across all DM variants, NoBridge ≥ Bridge in MRR. The bridge multiplier (rewarding replies that target multiple conclusions) may interact poorly with DM's modular score distribution.

## Comparison vs. 5-Thread Run

| Algorithm | 5-thread MRR | 20-thread MRR | Delta |
|---|---|---|---|
| EvidenceRank_Vote | 0.622 | 0.568 | -0.054 |
| Top | 0.517 | 0.502 | -0.015 |
| EvidenceRank_LLM | 0.479 | 0.397 | -0.082 |
| DampedModular_ReferenceBias_HC_NoBridge | 0.458 | 0.312 | -0.146 |
| QuadraticEnergy_LLM_HC | 0.457 | — (bugged) | — |
| DampedModular_Vote_HC_NoBridge | 0.452 | 0.351 | -0.101 |

Most algorithms show lower MRR on 20 threads. The 5-thread run likely had a favourable sample — these 20-thread numbers are more reliable.

## Next Steps

- Rerun benchmark after QE_LLM bug fix to get accurate QuadraticEnergy_LLM numbers
- Investigate high variance in Top and DM_LLM (outlier threads?)
- Consider whether EvidenceRank_Vote pattern can replace the production reference-bias approach
- Evaluate whether bridge multiplier should be disabled for DM variants
