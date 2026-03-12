# Review: ArgMining 2026 Workshop Specifications Compliance

Based on the ArgMining 2026 Call for Papers (co-located with ACL 2026, San Diego, July 2-3, 2026).

## Compliant

- **Paper type**: Short paper (4 pages)
- **Page limit**: 4 pages of content (title, text, figures, tables) + unlimited references — matches
- **Format**: ACL 2026 two-column format via `\usepackage[review]{acl}`
- **Double-blind review**: Author info suppressed; platform links omitted with anonymity footnote
- **Topic relevance**: Directly addresses multiple ArgMining topics:
  - Argument mining from online discussions (ChangeMyView)
  - Argument quality assessment (EvidenceRank ranking)
  - Argument structure prediction (extraction of ADUs, support/attack relations)
  - Argument aggregation and summarisation (deduplication across threads)
  - Applications of argument mining in social media platforms
- **Evaluation**: Uses established benchmarks (Persuasive Essays corpus, MultiPIT Expert) plus end-to-end CMV evaluation with statistical significance testing
- **References**: All references properly formatted with natbib; no page limit on references

## Issues to Fix

### 1. Submission deadline is March 12, 2026 [CRITICAL]
- Today is March 11, 2026
- Deadline is tomorrow — ensure submission via OpenReview or Softconf (check CFP for exact platform)
- All fixes below should be prioritized by submission impact

### 2. Ethical Considerations — still placeholder [HIGH]
- Same issue flagged in ACL format review
- ArgMining follows ACL ethics policy; placeholder boilerplate must be replaced or removed before submission

### 3. Acknowledgments in review version [HIGH]
- Same issue flagged in ACL format review
- Must be removed for double-blind review submission

### 4. Appendix length [CHECK]
- User mentioned 1-page appendix limit — this may be ArgMining-specific
- Current appendix is ~1 page after condensing, so likely compliant
- Verify against final CFP or workshop guidelines if a specific appendix limit is stated

## Topic Alignment

The paper aligns well with several ArgMining 2026 topics of interest:

| ArgMining Topic | Paper Coverage |
|---|---|
| Argument mining from online discussions | Core contribution (CMV pipeline) |
| Argument quality assessment | EvidenceRank ranking algorithm |
| Argument structure prediction | LLM extraction of claims, premises, relations |
| Aggregation / summarisation | Cross-thread deduplication via RAG pattern |
| Applications of argument mining | Deployed social knowledge platform |
| Resources and corpora | 206-thread CMV evaluation dataset |
| Integration of NLP and formal argumentation | QBAF-based EvidenceRank over extracted graphs |

## Pre-Submission Checklist
- [ ] Remove acknowledgments section
- [ ] Fix or remove Ethical Considerations section
- [ ] Verify PDF compiles cleanly with no warnings
- [ ] Confirm submission platform (OpenReview / Softconf / ARR)
- [ ] Upload by March 12, 2026 deadline
- [ ] Verify appendix fits within any workshop-specific page limit
