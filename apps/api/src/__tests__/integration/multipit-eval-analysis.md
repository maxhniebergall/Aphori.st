# MultiPIT Manual Pair Analysis

## Context

MultiPIT (Multiple Perspectives Information Taxonomy) is a Twitter paraphrase detection
dataset with expert annotations. Pairs are drawn from tweets about the same news event;
label=1 means the pair expresses the same information (paraphrase), label=0 means they
express different information despite sharing a topic.

**Dataset size**: 4,458 train / 555 val / 557 test (all splits combined: 5,570 pairs).
Label distribution: ~54% positive overall. Short sentences (median 64 chars), matching
ADU length range.

---

## Context vs Our Use Case

Our ADU deduplication pipeline identifies when two **argument claims** assert the same
**proposition** — e.g., two users independently making the claim "assisted suicide violates
the Hippocratic Oath." MultiPIT asks whether two **tweets** report the **same event fact**.

The two tasks overlap structurally (same-proposition detection) but differ in content type:

| Dimension | MultiPIT | Our ADU dedup |
|-----------|----------|---------------|
| Text type | Twitter news reports | Argument claims (policy/fact/value) |
| Claim type | Factual event reports | Normative + factual + policy |
| Hard case | Same event, different specificity | Same topic, different normative mechanism |
| Topicality pressure | Medium (diverse events) | High (all ADUs share a debate topic) |
| Length | 31–137 chars (median 64) | 34–244 chars |
| Domain | News/sports/current events | Social/political debates |

---

## Pair Table

5 positives (label=1), 5 negatives (label=0). Same 5 tests as ArgKP analysis.

**Tests:**
- **Substitutable** — Could you swap one for the other without changing what is being argued?
- **Redundant** — Would reading the second add any new information beyond the first?
- **Same counterargument** — Would the same rebuttal apply to both?
- **Bidir. entailment** — If A is true must B be true, AND if B is true must A be true?
- **Same scope** — Do they cover the same entities, conditions, and scale?

| # | A | B | Substitutable? | Redundant? | Same counterargument? | Bidir. entailment? | Same scope? | **Ground truth** |
|---|---|---|---|---|---|---|---|---|
| 1 | "Paul Maurice has resigned as the Winnipeg Jets head coach" | "Paul Maurice has resigned as the Head Coach of the Winnipeg Jets" | ✅ Yes — trivial capitalisation/word order | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | **DUPLICATE** |
| 2 | "The Jacksonville Jaguars fired Urban Meyer, ending his tumultuous NFL tenure after just 13 games" | "The Jacksonville Jaguars have fired their head coach Urban Meyer after only 13 games with the franchise" | ✅ Yes | ⚠️ Partial — A adds "tumultuous" (editorial) | ✅ Yes | ✅ Yes | ✅ Yes | **DUPLICATE** |
| 3 | "British High Court rules in favor of U.S. extradition of Julian Assange" | "The UK High Court rules Julian Assange can be extradited to the USA" | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | **DUPLICATE** |
| 4 | "Chris Cuomo fired by CNN after helping brother Andrew amid sexual harassment scandal" | "CNN Fires Chris Cuomo Over Involvement With Brother Andrew Cuomo's Sexual Misconduct Scandal" | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | **DUPLICATE** |
| 5 | "Parents of Michigan shooter have been arrested in Detroit via Fox News" | "Parents of alleged Michigan school shooter arrested in Detroit, authorities say" | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | **DUPLICATE** |
| 6 | "On this day in 1988, a bomb explodes on board PanAm Flight 103 over Lockerbie, Scotland killing 270" | "Today marks the 33 year anniversary of the Lockerbie disaster" | ❌ No — A is a detailed historical account, B is a commemoration frame | ❌ No — B adds no historical fact; A adds specific details | ❌ No — "the death toll was different" rebuts A; "the date is wrong" rebuts B | ❌ No — A asserts bomb+casualties; B only asserts an anniversary | ❌ No — A is granular, B is a label | **NOVEL** |
| 7 | "Peng Shuai now denies making any sexual assault claim against a top official" | "Peng Shuai denies making sex assault claim but WTA not convinced" | ❌ No — B adds a distinct second claim (WTA reaction) | ❌ No — B adds an entirely new assertion | ❌ No — rebuttal for A: "she was coerced to deny it"; rebuttal for B also needs "WTA is wrong" | ❌ No — B entails A but not vice versa | ❌ No — B has wider scope (includes WTA's position) | **NOVEL** |
| 8 | "The Netherlands has announced a strict lockdown against Omicron" | "The Netherlands is back in lockdown and I only see people blaming each other" | ❌ No — A is policy news, B adds a social reaction claim | ❌ No — B adds editorial "people blaming each other" | ❌ No — different rebuttals (A: "it wasn't that strict"; B: "the blame is warranted") | ❌ No — B entails A but not vice versa | ❌ No — B is broader (adds social commentary) | **NOVEL** |
| 9 | "Creed Humphrey absolutely ROBBED not getting to the pro bowl" | "Creed Humphrey is the best center in football and didn't make the pro bowl" | ⚠️ Partial — both argue Humphrey was snubbed | ❌ No — B adds "best center in football" as the basis | ❌ No — "he was not the best this year" rebuts B but not the snub claim in A | ❌ No — A asserts he was wronged; B asserts a ranking plus a result | ❌ No — A is about injustice, B is about ranking | **NOVEL** |
| 10 | "Sen. Cory Booker and Sen. Elizabeth Warren Test Positive for COVID" | "Elizabeth Warren and Cory Booker tested positive for the coronavirus, according to tweets from their official accounts" | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | **NOVEL** ⚠️ |

---

## Key Observations

### Pairs 1–5 — clean, unambiguous duplicates

All five tests agree unanimously on all five positive pairs. These are factual news reports
where the same event is stated in different words. No label noise; the tests perform well.
A dedup pipeline that handles factual paraphrase should get these right.

### Pair 6 — clean negative with granularity gap

A is a detailed historical statement (flight number, death toll, location). B is a
commemoration frame ("the 33 year anniversary"). They refer to the same event but make
different claims — A asserts specific facts, B asserts a temporal milestone. All five tests
agree: NOVEL. This is a well-formed hard negative.

### Pair 7 — clean negative with embedded second claim

A asserts Shuai's denial. B asserts both her denial AND the WTA's non-acceptance. B is a
strictly more informative statement — it entails A but not vice versa. The pipeline must
not merge these. The disqualifier "scope mismatch" (B covers more ground) should catch this.

### Pair 9 — hard negative with shared conclusion

Both tweets argue Humphrey was snubbed from the Pro Bowl. A frames it as injustice
("ROBBED"); B frames it as a ranking claim ("best center in football"). Different
counterarguments apply. This is the same pattern as ArgKP Pair 8 (same topic, same
direction, different grounding) — the hardest class for an LLM.

### Pair 10 — label noise (probable false negative)

Ground truth: NOVEL. But all five tests say DUPLICATE. Both tweets report the same medical
event for the same two people with no new information. The only difference is that B adds
"according to tweets from their official accounts" (a sourcing qualifier). A pipeline that
marks this as DUPLICATE is likely making the correct decision for an argument graph —
these should share a canonical node.

---

## Comparison with ArgKP

| Dimension | MultiPIT | ArgKP |
|-----------|----------|-------|
| Claim type | Factual event reports | Argument claims (debate-style) |
| Hard negative type | Specificity gaps, embedded second claims | Same normative direction, different grounding |
| Label noise | Minor — ~1 in 10 hard negatives looks mislabelled | Moderate — ~2/5 positive pairs fail strict propositional equivalence |
| Domain pressure | Medium — events are diverse across topics | High — all ADUs share a single debate topic |
| Size | 5,570 pairs | 81k rows (filterable to thousands of eval pairs) |
| Benchmark validity | Good for factual dedup | Better match for argumentative dedup |

---

## Suitability Assessment

**Verdict: Partially suitable — good sanity check, not the primary benchmark.**

**Strengths:**
- Large and well-balanced (5,570 pairs)
- Expert-annotated with high inter-annotator agreement
- Diverse topics (156 unique anchor topics in train)
- Length and format closely match ADU size
- Hard negatives test the "same topic, different claim" distinction our pipeline must make

**Limitations:**
- **Wrong content type (main limitation)**: All pairs are factual event reports. Our pipeline's
  hardest errors occur on normative/policy claims where "same claim" is semantically fuzzier
  (e.g., "assisted suicide reduces suffering" vs "terminally ill should be allowed to die
  with dignity" — same direction, different proposition). MultiPIT does not stress this case.
- **Low topicality pressure**: In MultiPIT, pairs from different events are trivially NOVEL.
  In our production use, all ADUs share a debate topic, making topical similarity the main
  confound. MultiPIT pairs are from different topics by construction — the LLM doesn't need
  to control for shared topic.
- **No POLICY/VALUE claims**: Our pipeline handles FACT, POLICY, and VALUE epistemic types.
  MultiPIT is entirely FACT. The hardest dedup cases (two users making the same normative
  claim in different words) are absent.

**Recommended use**: Run MultiPIT as a **precision floor test** — our pipeline should achieve
high precision on factual paraphrase detection (F1 > 0.7) because these are easier cases.
If we score poorly on MultiPIT, there is a fundamental problem with the pipeline. ArgKP
remains the primary benchmark for argumentative dedup quality because it stresses the
harder normative-claim case.

---

## Prompt Design Implications

The hard negative Pair 9 ("ROBBED not getting to pro bowl" / "best center in football,
didn't make the pro bowl") reinforces the ArgKP analysis findings: the CONTRAST test
("would the same counterargument apply?") is the most discriminating test for this class.
Both pairs share a conclusion but ground it differently — the rebuttals diverge.

For our current prompt design, the disqualifier "they describe different mechanisms,
entities, or consequences, even if both support the same conclusion" directly captures
Pairs 7, 8, and 9. This is good evidence that the disqualifier rule is well-targeted.
