# Hyperparameter Tuning Results

**Dataset**: webis-cmv-20 (n=20 threads, t3_3x3qgo excluded — stuck LLM call)
**Method**: Offline grid search on cached raw graph + LLM scores (no LLM re-calls)
**Primary metric**: MRR (Mean Reciprocal Rank of first delta reply)

---

## ER Damping Sweep

Fixed: `bridgeCoeff=0.5`

| damping | ER_Vote | ER_LLM |
|---------|---------|--------|
| 0.70    | 0.560   | 0.378  |
| 0.80    | 0.563   | 0.378  |
| 0.85 *(default)* | 0.567 | 0.379 |
| 0.90    | 0.575   | **0.405** ★ |
| **0.95** ★ | **0.575** | 0.405 |

→ Recommended: `damping = 0.95` (tied with 0.90 for Vote; 0.90 best for LLM)

---

## QE Alpha Sweep

Fixed: `phase1Coeff=0.49`, `bridgeCoeff=0.5`

| alpha | QE_Vote | QE_LLM |
|-------|---------|--------|
| 0.05  | 0.361   | 0.303  |
| **0.10** ★ | **0.361** | **0.303** ★ |
| 0.15  | 0.361   | 0.295  |
| 0.20 *(default)* | 0.361 | 0.295 |
| 0.30  | 0.361   | 0.295  |
| 0.40  | 0.361   | 0.295  |

→ Alpha is largely insensitive for Vote. Slight preference for `0.10` (LLM).
→ Recommended: `alpha = 0.10`

---

## QE Phase1Coeff Sweep

Fixed: `alpha=0.10`, `bridgeCoeff=0.5`

| phase1Coeff | QE_Vote | QE_LLM |
|-------------|---------|--------|
| **0.30** ★  | 0.361   | **0.337** ★ |
| 0.40        | 0.361   | 0.335  |
| 0.45        | 0.361   | 0.336  |
| 0.49 *(default)* | **0.361** ★ | 0.303 |

→ Vote is flat. LLM improves significantly with tighter prior: `0.30` (+11% vs default 0.49).
→ Recommended: `phase1Coeff = 0.30`

---

## Bridge Coeff Sweep

Fixed: `erDamping=0.95`, `qeAlpha=0.10`, `qePhase1=0.30`

| coeff | ER_Vote | ER_LLM | QE_Vote | QE_LLM | DM_LLM |
|-------|---------|--------|---------|--------|--------|
| 0.00  | 0.555   | **0.406** ★ | 0.362 | 0.286 | 0.334 |
| 0.25  | 0.579   | 0.404  | **0.372** ★ | **0.315** ★ | 0.397 |
| 0.50 *(default)* | 0.575 | 0.405 | 0.361 | 0.303 | 0.398 |
| **1.00** ★ | **0.593** | 0.392 | 0.359 | 0.305 | 0.401 |
| 2.00  | 0.517   | 0.371  | 0.357  | 0.312  | **0.401** ★ |

→ Bridge effect is **signal-dependent**:
- Vote-weighted: `1.0` best for ER (+3.1% vs default), `0.25` best for QE
- LLM-weighted: bridge hurts (ER_LLM peaks at `0.0`; QE_LLM at `0.25`)
- DM_LLM: flat above 0.5

---

## Summary

| Param | Default | Best | Delta |
|-------|---------|------|-------|
| `erDamping` | 0.85 | **0.95** | +0.008 MRR on ER_Vote |
| `qeAlpha` | 0.20 | **0.10** | negligible on Vote |
| `qePhase1Coeff` | 0.49 | **0.30** | +0.034 MRR on QE_LLM |
| `bridgeCoeff` (Vote) | 0.50 | **1.00** | +0.018 MRR on ER_Vote |
| `bridgeCoeff` (LLM) | 0.50 | **0.00** | +0.001 MRR on ER_LLM |

**Best configuration per variant:**

| Variant | Best MRR | vs baseline (v4) |
|---------|----------|-----------------|
| ER_Vote + bridge=1.0 | **0.593** | — |
| ER_LLM + bridge=0.0 | **0.406** | — |
| QE_Vote + bridge=0.25 | 0.372 | — |
| QE_LLM (phase1=0.30) + bridge=0.25 | 0.315 | — |
| DM_LLM + bridge=2.0 | 0.401 | — |

**Overall winner: `EvidenceRank_Vote` with `damping=0.95`, `bridgeCoeff=1.0` → MRR 0.593**
