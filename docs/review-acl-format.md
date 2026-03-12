# Review: ACL 2026 Formatting Guidelines Compliance

Based on https://acl-org.github.io/ACLPUB/formatting.html

## Compliant

- **Page limit**: 4 pages content for short paper (matches limit)
- **Two-column format**: Using `acl` package with proper column layout
- **Font**: Using Times via `\usepackage{times}`
- **Paper size**: Standard A4 via acl class
- **Abstract length**: ~135 words (limit is 200 words)
- **Review mode**: `\usepackage[review]{acl}` — produces line numbers, anonymous output
- **Anonymity**: Author info suppressed in review output ("Anonymous ACL submission"); platform links omitted with footnote explanation
- **Section numbering**: Arabic numerals for main sections
- **Tables/Figures**: Numbered sequentially, captions below, properly placed
- **Citations**: Using `\citep{}` and `\citet{}` correctly; consistent Author (Year) format
- **LaTeX packages**: Standard packages (booktabs, amsmath, graphicx, microtype, etc.)
- **Figure format**: Architecture diagram in PDF vector format
- **Footnotes**: Properly formatted at page bottom

## Issues to Fix

### 1. Acknowledgments must be removed for review [HIGH]
- ACL guidelines: "Do not include in review versions"
- Current: `\section*{Acknowledgments}` with content visible
- **Fix**: Comment out or wrap in a conditional for review mode

### 2. Ethical Considerations section has placeholder text [HIGH]
- Currently contains ACL template boilerplate, not actual content
- Either write real content or remove the section entirely (it's optional)
- If kept, should be unnumbered: `\section*{Ethical Considerations}`

### 3. Ethical Considerations is numbered [MEDIUM]
- PDF shows "5 Ethical Considerations" — should be unnumbered
- **Fix**: Use `\section*{Ethical Considerations}`

### 4. DOIs missing from some references [LOW]
- ACL: "Must include DOIs when possible; otherwise link to ACL Anthology"
- Several bib entries lack DOIs (Baroni 2018, Lawrence & Reed 2017, Li 2025, Savingy 2025, etc.)
- Some entries already have DOIs (Ajjour, Kashefi, Gemechu, etc.)
- **Fix**: Add DOIs where available, or ACL Anthology URLs

### 5. Appendix page limit [CHECK]
- ACL formatting guide does not specify an appendix page limit
- User mentioned 1-page limit — this may be ArgMining-specific
- Current appendix is ~1 page after condensing

### 6. References completeness [LOW]
- Some arXiv preprints (Li 2025, Alfano 2025, Savingy 2025) lack page numbers or formal venue
- This is acceptable for preprints but should be updated if published by camera-ready

### 7. Self-containment [OK]
- ACL: "Review versions must be self-contained"
- Paper does not rely on supplementary material or unavailable resources
- The omitted platform link is properly noted; paper is understandable without it

## Formatting Checklist (Pre-Submission)
- [ ] Remove acknowledgments for review version
- [ ] Fix or remove Ethical Considerations section
- [ ] Verify all fonts are embedded (`pdffonts` check)
- [ ] Add DOIs to references where available
- [ ] Verify PDF renders correctly on multiple systems
- [ ] Check that figure is legible in grayscale
