      11 ## Results (sorted by MRR)
      12
      13 | Algorithm | MRR | Mean Rank | ±Std | Median Rank |
      14 |---|---|---|---|---|
      15 | EvidenceRank_Vote | **0.568** | 3.5 | ±3.6 | 2.0 |
      16 | EvidenceRank_Vote_NoBridge | 0.548 | 3.4 | ±3.3 | 2.0 |
      17 | Top | 0.502 | 7.7 | ±13.2 | 2.0 |
      18 | EvidenceRank_LLM_NoBridge | 0.399 | 7.8 | ±12.0 | 3.0 |
      19 | EvidenceRank_LLM | 0.397 | 9.0 | ±13.0 | 5.0 |
      20 | DampedModular_LLM | 0.392 | 14.3 | ±17.9 | 4.0 |
      21 | QuadraticEnergy_Vote *(bugged QE_LLM = same)* | 0.368 | 6.6 | ±6.2 | 4.5 |
      22 | QuadraticEnergy_Vote_NoBridge *(bugged QE_LLM_NoBridge = same)* | 0.366 | 5.2 | ±3.9 | 4.0 |
      23 | DampedModular_ReferenceBias_NoBridge | 0.354 | 6.3 | ±5.6 | 4.5 |
      24 | DampedModular_Vote_HC_NoBridge | 0.351 | 6.5 | ±5.9 | 4.0 |
      25 | DampedModular_Vote_NoBridge | 0.349 | 7.2 | ±7.2 | 4.0 |
      26 | DampedModular / DampedModular_Vote | 0.338 | 9.0 | ±11.0 | 3.0 |
      27 | DampedModular_Vote_HC | 0.338 | 7.8 | ±7.2 | 4.5 |
      28 | DampedModular_LLM_NoBridge | 0.336 | 13.8 | ±16.3 | 6.5 |
      29 | DampedModular_LLM_HC | 0.333 | 10.9 | ±12.4 | 4.5 |
      30 | DampedModular_ReferenceBias | 0.326 | 8.2 | ±8.5 | 4.0 |
      31 | DampedModular_ReferenceBias_HC | 0.318 | 6.9 | ±6.0 | 4.5 |
      32 | DampedModular_ReferenceBias_HC_NoBridge | 0.312 | 6.2 | ±4.8 | 4.5 |
      33 | DampedModular_LLM_HC_NoBridge | 0.308 | 10.0 | ±10.7 | 8.5 |
      34 | EvidenceRank (production) | 0.173 | 2.4 | ±1.7 | 1.0 |
      35 | QuadraticEnergy (production) | 0.152 | 2.4 | ±1.5 | 2.0 |