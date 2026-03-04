# Sci-Arg / BAM `semantically_same` Manual Pair Analysis

## Context

BAM (Benchmarking Argument Mining on Scientific Documents) uses the Sci-Arg corpus, which
contains BRAT-format annotations with a `semantically_same` relation between argument
components within scientific papers. The claim was that this subset provides ~792 pairs
suitable for argument deduplication evaluation.

**Actual count: 44 `semantically_same` pairs** (not 792) across 40 scientific papers on
3D computer graphics and animation (SSD, quaternions, fluid simulation, cloth wrinkles, etc.).

The BAM pipeline maps `semantically_same` → `noRel` (treats it as a structural non-relation)
because it only cares about support/attack structure — the equivalence labels are discarded
by the benchmark. They are raw annotations in the underlying Sci-Arg `.ann` files.

---

## Pair Table

5 true duplicates (`semantically_same`), 5 true negatives (`noRel`).

Same five tests as the ArgKP analysis:
- **Substitutable** — Could you swap one for the other without changing what is being argued?
- **Redundant** — Would reading the second add any new information beyond the first?
- **Same counterargument** — Would the same rebuttal apply to both?
- **Bidir. entailment** — If A is true must B be true, AND if B is true must A be true?
- **Same scope** — Do they cover the same entities, conditions, and scale?

| # | A | B | Substitutable? | Redundant? | Same counterargument? | Bidir. entailment? | Same scope? | **Ground truth** |
|---|---|---|---|---|---|---|---|---|
| 1 | "the inverse method is superior" | "the superiority of the inverse method" | ✅ Yes — pure nominalization | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | **DUPLICATE** |
| 2 | "Most character deformation techniques can be roughly categorized into two groups" | "There are two general categories of methods in animation practice" | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | **DUPLICATE** |
| 3 | "SLERP and QLERP differ only in angle, strictly less than 0.143 radians" | "the only difference between QLERP and SLERP is in the angle of rotations" | ✅ Yes | ⚠️ Partial — A adds the 0.143 rad bound | ✅ Yes | ⚠️ Partial — A entails B; B doesn't entail A's specific bound | ✅ Yes — same algorithm pair | **DUPLICATE** ⚠️ |
| 4 | "the change of momentum = internal elastic forces + externally applied body forces" | "which expresses Newton's equation of motion" | ❌ No — A is the math; B names the law | ❌ No — B is a label for A, not a paraphrase | ❌ No — "Newton's 2nd law doesn't apply here" rebuts A; "this isn't Newton's equation" rebuts B | ❌ No — A entails B but not vice versa | ❌ No — A is the specific equation, B is a name | **DUPLICATE** ⚠️ |
| 5 | "many more constraints can be implemented" | "These are only a few of the constraints that can be implemented" | ✅ Yes — contrastive phrasings of same claim | ✅ Yes | ✅ Yes — "extensibility is limited" rebuts both | ✅ Yes | ✅ Yes | **DUPLICATE** |
| 6 | "complicated 3D character models are widely used in entertainment, VR, medicine" | "providing a flexible and efficient solution to animation remains an open problem" | ❌ No | ❌ No — A is prevalence, B is a research gap | ❌ No — entirely different claims | ❌ No | ❌ No | **NOVEL** |
| 7 | "complicated 3D character models are widely used in entertainment, VR, medicine" | "Skeleton Subspace Deformation (SSD) is the predominant approach to character skinning" | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No — A is domain prevalence, B is a technical claim | **NOVEL** |
| 8 | "Real-time animation of deformable objects is always a compromise between visual fidelity and computation complexity" | "They differ by the intended area of application and generality of allowed models" | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No — B's referent ("they") is unclear (pronoun noise) | **NOVEL** |
| 9 | "Real-time animation of deformable objects is always a compromise between visual fidelity and computation complexity" | "Its most popular representative, known as skeletal animation, is based on simple but versatile structure" | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No — different entities | **NOVEL** |
| 10 | "Modeling in 3D is becoming much easier than before" | "Bringing these static shapes to life" | ❌ No — B is an incomplete fragment | ❌ No | ❌ No | ❌ No | ❌ No | **NOVEL** |

---

## Key Observations

### Dataset is much smaller than reported

The corpus contains **44 `semantically_same` pairs**, not ~792. The figure of 792 does not
correspond to any subset of the Sci-Arg annotations. (The relation `parts_of_same` has 1,298
instances and `supports` has 5,804 — neither matches 792 either.)

### Pairs 1, 2, 5 — clean duplicates with good signal

All five tests agree unanimously. These are well-formed equivalences that a dedup pipeline
should catch: same claim restated via nominalization, paraphrase, or logical equivalence.

### Pair 3 — loose duplicate (scope mismatch)

A is more specific than B: A contains the quantitative bound (< 0.143 rad) that B lacks.
Bidirectional entailment fails because B does not recover A's specific value. This is the
same pattern seen in ArgKP Pair 2 — the label clusters "same topic" not "same proposition".

### Pair 4 — severe label noise

A ("the change of momentum = elastic forces + body forces") is a full mathematical statement.
B ("which expresses Newton's equation of motion") is a label or name for that statement.
These are not paraphrases — B is a description of A. All five tests say NOVEL; ground truth
says DUPLICATE. A dedup pipeline that correctly rejects this pair would be penalised.

### Negative pairs — unresolved pronouns and fragments

Pairs 8 and 10 contain dangling references ("they", "its", "these shapes") with no
antecedent in the excerpt. A rewrite step would help, but the problem is upstream: these
are document-level annotations extracted out of context.

---

## Suitability Assessment for ADU Deduplication Benchmark

**Verdict: Not suitable.** Five independent reasons:

### 1. Domain mismatch (fatal)

Every paper in Sci-Arg is a technical computer graphics paper (SSD, quaternions, fluid
simulation, cloth wrinkles). Our ADU deduplication operates on debate-style arguments
about social/political topics. Topicality — the main confounding factor we are trying to
control — is absent here. The LLM is unlikely to confuse claims about quaternion SLERP with
claims about assisted suicide.

### 2. Too small (fatal)

44 positive pairs is too few to produce statistically meaningful P/R/F1 estimates. ArgKP
gave us thousands of positive pairs across multiple topics. Sci-Arg gives 44 across one
narrow domain.

### 3. Within-document pairs (fundamental mismatch)

All `semantically_same` pairs are within a single paper — the same author repeating the
same point. Our production scenario is cross-post (different users making the same claim).
Within-document pairs share authorial voice and adjacent context, making them far easier
to detect. The eval would not stress the hardest cases.

### 4. Pairs 1–8 are a transitive cluster, not independent pairs

In paper A01, pairs 1–8 are not independent — they form a transitive equivalence cluster
where multiple phrasings of "the inverse method works better" are all linked to each other.
This inflates the positive count and introduces redundant, low-information test cases.

### 5. Label noise of a different type than ArgKP

ArgKP's noise is topical clustering (same direction → same key_point). Sci-Arg's noise is
definitional conflation (equation ↔ law name). Both penalise a pipeline that makes
propositionally correct decisions. Neither is better than the other as a benchmark flaw —
but Sci-Arg's noise is rarer (only pair 4 in our sample) while its domain/size problems
are disqualifying.

---

## Conclusion

The BAM/Sci-Arg `semantically_same` subset is a dead end for this benchmark. The ArgKP
dataset remains our best available option: it is large, multi-topic, debate-style, and
its label noise is understood and bounded. The right next step is to continue improving
the prompt against ArgKP and accept that measured precision is a lower bound (per the
analysis in `argkp-eval-analysis.md`).
