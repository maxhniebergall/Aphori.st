# Benchmark Algorithms

This document describes all algorithms evaluated in the Aphorist argument-mining benchmark.

## Evaluation Setup

- **Dataset**: webis-cmv-20 (Reddit r/ChangeMyView threads)
- **Task**: Rank reply comments so that delta-awarded replies (i.e., replies that changed the OP's mind) appear highest
- **Metrics**:
  - **MRR** (Mean Reciprocal Rank): mean of 1/rank of the first delta reply per thread
  - **Mean Rank**: average rank of the first delta reply
  - **Median Rank**: median rank of the first delta reply
  - **Win Rate**: fraction of threads where this algorithm's RR exceeds the comparison baseline

## Algorithm Matrix

17 algorithm variants are evaluated. Each combines a ranking strategy, an apriori weight source, and an optional bridge multiplier.

| Algorithm Key | Strategy | Apriori Weight Source | Bridge |
|---|---|---|---|
| EvidenceRank | EvidenceRankStrategy | Reference Bias | Yes |
| QuadraticEnergy | QuadraticEnergyStrategy | Reference Bias | Yes |
| Top | Vote score baseline | Vote | N/A |
| EvidenceRank_Vote | EvidenceRankStrategy | Vote | Yes |
| EvidenceRank_Vote_NoBridge | EvidenceRankStrategy | Vote | No |
| EvidenceRank_LLM | EvidenceRankStrategy | LLM | Yes |
| EvidenceRank_LLM_NoBridge | EvidenceRankStrategy | LLM | No |
| QuadraticEnergy_Vote | QuadraticEnergyStrategy | Sigmoid Vote | Yes |
| QuadraticEnergy_Vote_NoBridge | QuadraticEnergyStrategy | Sigmoid Vote | No |
| QuadraticEnergy_LLM | QuadraticEnergyStrategy | LLM | Yes |
| QuadraticEnergy_LLM_NoBridge | QuadraticEnergyStrategy | LLM | No |
| DampedModular_Vote | DampedModularStrategy | Sigmoid Vote | Yes |
| DampedModular_Vote_NoBridge | DampedModularStrategy | Sigmoid Vote | No |
| DampedModular_LLM | DampedModularStrategy | LLM | Yes |
| DampedModular_LLM_NoBridge | DampedModularStrategy | LLM | No |
| DampedModular_ReferenceBias | DampedModularStrategy | Reference Bias | Yes |
| DampedModular_ReferenceBias_NoBridge | DampedModularStrategy | Reference Bias | No |

### Apriori Weight Source Values

- **Reference Bias**: LLM detects external references (books, URLs, citations) in argument text; their presence biases `basic_strength` upward via the source-reputation stage of the nightly processor. Used by the nightly-precomputed production baselines (EvidenceRank, QuadraticEnergy).
- **Vote**: Raw Reddit vote score — used directly as a seed weight (ER) or as the sort key (Top).
- **Sigmoid Vote**: `sigmoid(vote_score)` — normalises vote score to (0, 1) for algorithms that require a bounded base weight (QE, DM).
- **LLM**: Gemini quality score — argument persuasiveness rated 0→1 by the discourse engine at analysis time.

### Bridge Multiplier

When enabled, a reply's score is multiplied by `1 + 0.5 * (unique_conclusion_targets - 1)`. This rewards replies whose i-nodes collectively address multiple distinct claims in the parent post — a proxy for argumentative breadth.

## Per-Algorithm Description

### EvidenceRankStrategy (`EvidenceRank`)

**Source**: `apps/api/src/services/experiments/EvidenceRankStrategy.ts`

A graph-centrality ranking adapted for bipolar weighted argumentation. Uses vote-seeded PageRank-style propagation with an evidence-weighted damping factor. Precomputed nightly and stored in the `evidence_rank` column.

**Production use**: Yes — powers the default feed sort.

---

### QuadraticEnergyStrategy (`QuadraticEnergy`)

**Source**: `apps/api/src/services/experiments/QuadraticEnergyStrategy.ts`

**Reference**: Potyka, N. (2018). *Continuous Dynamical Systems for Weighted Bipolar Argumentation*. KR 2018.

**Iteration formula**:

```
w_i      = clamp(basic_strength, 0.01, 0.99)
B_i      = ln(w_i / (1 - w_i))          [logit]
v_i(0)   = w_i
E_i(t)   = B_i + Σ_{s supports i} v_s(t) - Σ_{a attacks i} v_a(t)
target_i = sigmoid(E_i)
v_i(t+1) = v_i(t) + α * (target_i - v_i(t))   [α = 0.2]
```

Halts when `max |v_i(t+1) - v_i(t)| < ε` (ε = 0.001), or after 50 iterations.

**Inertia**: When there are no edges, `E_i = B_i`, so `target_i = sigmoid(logit(w_i)) = w_i`, and `v_i` remains exactly `w_i`.

**Convergence on cyclic graphs**: The Euler-step formulation is a continuous approximation of the energy-minimisation ODE from Potyka 2018. On finite weighted bipolar graphs, the energy functional has a unique minimum, guaranteeing convergence regardless of cycles.

**Production use**: Yes — Stage 7 of the nightly graph processor computes QE scores and stores them in the `wb_score` column (replacing WeightedBipolar). Served as `quadratic_energy` in the benchmark API and as the production `weighted_bipolar` sort key in the feed.

---

### DampedModularStrategy (`DampedModular`)

**Source**: `apps/api/src/services/experiments/DampedModularStrategy.ts`

**Reference**: Potyka, N. (2019). *Extending Modular Semantics for Bipolar Weighted Argumentation*. AAMAS 2019.

**Iteration formula**:

```
w_i      = clamp(basic_strength, 0.0, 1.0)
v_i(0)   = w_i
agg_i(t) = Σ_{s supports i} v_s(t) - Σ_{a attacks i} v_a(t)
inf_i    = 1 - (1 - w_i²) / (1 + w_i * exp(agg_i))
v_i(t+1) = (1 - α) * v_i(t) + α * inf_i   [α = 0.5]
```

Halts when `max |v_i(t+1) - v_i(t)| < ε` (ε = 0.001), or after 50 iterations.

**Inertia (exact)**: When `agg_i = 0`:
```
inf_i = 1 - (1 - w_i²) / (1 + w_i)
      = 1 - (1 - w_i)(1 + w_i) / (1 + w_i)
      = 1 - (1 - w_i)
      = w_i
```
So `v_i(t+1) = (1 - α) * w_i + α * w_i = w_i` — inertia holds exactly.

**Convergence on cyclic graphs**: The damping factor α < 1 ensures each update is a convex combination of the previous value and the modular influence, which is a contraction mapping under the Potyka 2019 conditions.

**Production use**: No — DM is benchmarked in-memory only via its Vote/LLM/ReferenceBias variants. If DM proves superior in benchmarks, promoting it to production would require a Stage 7 extension and DB migration.

---

### Top (vote baseline)

Replies sorted directly by their raw vote score. No graph analysis. Serves as the lower-bound baseline.

## Aggregation Pipeline

Ranking algorithms produce scores for individual i-nodes (argument discourse units). These are aggregated to reply level as follows:

1. **Degree centrality multiplier**: `node_score = strategy_score * log(1 + degree_centrality)` where `degree_centrality` is the number of outgoing scheme edges from the i-node. Rewards i-nodes that are premises for many conclusions.

2. **Reply score**: For each reply, take the maximum `node_score` across all its i-nodes.

3. **Bridge multiplier** (when enabled): `reply_score *= 1 + 0.5 * (unique_conclusion_targets - 1)`. `unique_conclusion_targets` is the number of distinct conclusion i-nodes targeted by any premise i-node from this reply. Rewards argumentative breadth.

4. **Ranking**: Replies sorted by descending `reply_score`; rank 1 = highest score.

## Removed Algorithms

### WeightedBipolarStrategy (removed)

**Was**: `apps/api/src/services/experiments/WeightedBipolarStrategy.ts`

**Removal reason**: Mathematically unstable hybrid of DF-QuAD and exponential decay with incorrect citations (cited as Amgoud & Ben-Naim 2015/2018, but the actual formula did not match those papers). On cyclic graphs (A attacks B, B attacks A — common in our platform), the discrete step-by-step iteration oscillated and failed to converge. Replaced by QuadraticEnergyStrategy (Potyka 2018) which provably converges on cyclic weighted bipolar graphs.

**Migration**: The nightly processor's Stage 7 now runs QuadraticEnergyStrategy instead of WeightedBipolarStrategy. Scores continue to be stored in the existing `wb_score` column — no DB schema change required.
