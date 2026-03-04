# ArgKP Manual Pair Analysis

## Context

IBM ArgKP dataset, topic: "Assisted suicide should be a criminal offence"
10 pairs selected: 5 true duplicates (same key_point), 5 true negatives (different key_points, same topic).
Each test applied independently per pair.

**Tests:**
- **Substitutable** — Could you swap one for the other in any argument without changing what is being argued?
- **Redundant** — Would reading the second add any new information beyond the first?
- **Same counterargument** — Would the same rebuttal apply to both? If a rebuttal to one doesn't apply to the other, they're making different claims.
- **Bidir. entailment** — If A is true must B be true, AND if B is true must A be true?
- **Same scope** — Do they cover the same entities, conditions, and scale?

---

## Pair Table

| # | A | B | Substitutable? | Redundant? | Same counterargument? | Bidir. entailment? | Same scope? | **Ground truth** |
|---|---|---|---|---|---|---|---|---|
| 1 | "helping someone commit suicide is like killing them yourself" | "death is death, at the end of the day someone is dead and you had a hand in it" | ✅ Yes | ✅ Yes — both say assistant = killer | ✅ Yes — "intent matters" rebuts both | ✅ Yes | ✅ Yes | **DUPLICATE** |
| 2 | "people should be allowed to die with dignity" | "assisted suicide allows people to die with dignity; if a crime they endure agony" | ⚠️ Partial — B adds the policy consequence | ❌ No — B adds "criminalisation causes suffering" | ✅ Yes | ❌ No — B entails A, A doesn't entail B | ❌ No — B is more specific | **DUPLICATE** ⚠️ |
| 3 | "doctors take an oath to do no harm — assisting violates this" | "The Hippocratic Oath states 'First, do no harm' — violates duty not to harm" | ✅ Yes | ✅ Yes — same oath, same conclusion | ✅ Yes | ✅ Yes | ✅ Yes | **DUPLICATE** |
| 4 | "should be allowed when a person suffers from severe illness" | "many people suffer terribly but are physically incapable of dying on their own" | ❌ No — A is a policy claim, B is a factual premise | ❌ No — B describes inability, A asserts permission | ❌ No — "palliative care suffices" rebuts A but not B | ❌ No | ❌ No — A is policy, B is descriptive | **DUPLICATE** ⚠️ |
| 5 | "not an offence if suffering from incurable disease, they die anyway" | "not a criminal defense for terminal cancer — doing them a mercy" | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes — both terminally ill | **DUPLICATE** |
| 6 | "people should be allowed to die with dignity" | "many people suffer terribly but are physically incapable of dying on their own" | ❌ No | ❌ No — B is a factual premise, A is a normative claim | ❌ No — "palliative care" rebuts A; "physical assistance exists" rebuts B | ❌ No | ❌ No | **NOVEL** |
| 7 | "no human being has the right to determine whether another lives or dies" | "could encourage murder under the guise of assisted suicide" | ❌ No — entirely different mechanism | ❌ No | ❌ No — different counterarguments entirely | ❌ No | ❌ No | **NOVEL** |
| 8 | "should be allowed in circumstances of severe illness" | "terminally ill should be able to choose to end the pain" | ⚠️ Partial — similar conclusion, different framing | ❌ No — A is circumstance-based, B is autonomy-based | ❌ No — "conditions can be faked" rebuts A; "autonomy has limits" rebuts B | ❌ No | ❌ No — A is about suffering threshold, B is about choice | **NOVEL** |
| 9 | "many people lack mental capacity to comprehend finality — will be abused" | "can be abused by relatives with ulterior motives" | ❌ No | ❌ No — different abuse vectors | ❌ No — "capacity screening works" rebuts A; "legal safeguards work" rebuts B | ❌ No | ❌ No — different entities (patient vs relatives) | **NOVEL** |
| 10 | "doctors take an oath to do no harm — assisting violates this" | "no other person should help you take your life" | ❌ No — A is doctor-specific, B is universal | ❌ No | ❌ No — "oath is outdated" rebuts A; "bodily autonomy" rebuts B | ❌ No | ❌ No — A is doctor-scoped, B is universal | **NOVEL** |

---

## Key Observations

### The tests are largely consistent and discriminating

For pairs 1, 3, 5 (clean duplicates) and 6, 7, 9, 10 (clean negatives), all five tests agree unanimously. The battery works well on clear cases.

### Pair 2 — dataset label noise (loose duplicate)

Ground truth: DUPLICATE (key_point: "Assisted suicide gives dignity").
Test results: 4 out of 5 say NOVEL.

B ("assisted suicide allows people to die with dignity; if a crime they endure agony") is strictly more specific than A ("people should be allowed to die with dignity"). B entails A but A does not entail B. B adds a distinct causal claim (criminalisation → prolonged agony) that A lacks entirely.

These cluster to the same key_point because both are *about* dignity, not because they assert the same proposition. The ArgKP key_point clusters are argumentatively related claims, not strictly identical ones.

### Pair 4 — dataset label noise (different epistemic types)

Ground truth: DUPLICATE (key_point: "Assisted suicide reduces suffering").
Test results: 5 out of 5 say NOVEL.

A ("should be allowed when a person suffers from severe illness") is a POLICY claim.
B ("many people suffer terribly but are physically incapable of dying on their own") is a FACT claim.

These are not the same claim at all — B is a premise that might *support* A, but they play entirely different roles in an argument. The key_point cluster conflates a factual observation with a policy prescription because they point in the same direction.

### Pair 8 — subtle semantic split

Ground truth: NOVEL (different key_points: "reduces suffering" vs "personal choice").
Test results: 4 out of 5 say NOVEL, with substitutability being borderline.

This is the hardest case for the LLM: both argue against criminalisation, both mention terminal illness and pain. But A is grounded in the severity of suffering (circumstantial threshold) and B is grounded in autonomy (the right to choose). These generate different counterarguments and are not interchangeable in a debate.

---

## Implications for Benchmark Validity

Pairs 2 and 4 reveal that **the ArgKP key_point clusters are not strict propositional equivalence classes**. They group arguments that serve the same rhetorical function or point toward the same conclusion, which is a weaker relation than identity.

This has a direct consequence for our evaluation: **our pipeline's measured precision is artificially depressed** because some of our FPs may be correct rejections of claims the dataset loosely groups together. A pipeline that correctly identifies pairs 2 and 4 as NOVEL would be penalised by the benchmark even though it is making the right decision for the argument graph.

The F1 scores should therefore be read as a lower bound on true pipeline precision. The meaningful signal is in the recall direction — FNs are more trustworthy as genuine errors than FPs.

---

## Prompt Design Conclusions

The five tests split into two roles:

**Positive signal (use to confirm DUPLICATE):**
- Substitutability
- Redundancy
- Same counterargument

**Disqualifiers (use to reject even if positive signal exists):**
- Bidirectional entailment failure (one is a specialisation of the other)
- Scope mismatch (different entities, conditions, scale)

The key structural insight: the positive tests should be *sufficient* to call DUPLICATE when they all agree, but the disqualifiers should be able to veto. This is the hybrid approach — positive framing as primary criterion, formal logic gates as veto conditions only.

Bidirectional entailment in natural language is too strict as a positive requirement (pair 2 fails it but is labelled DUPLICATE), but it is a reliable disqualifier when clearly asymmetric (pair 4, pair 8).
