# Review: Overleaf Document vs Local Section Files

Compared `/Users/mh/Downloads/acl_latex.tex` against local `docs/*.tex` files.

## Synced (no issues)
- **Abstract** (`abstract-section.tex`): Matches Overleaf lines 105-111
- **Introduction** (`introduction-section.tex`): Matches Overleaf lines 113-121, including all new citations (Li survey, Chen, Al Zubaer, Lawrence & Reed, Alfano, AMELIA, ArgueMapper, dedup prior art)
- **Approach** (`approach-section.tex`): Matches Overleaf lines 124-141, including "built and deployed" language, platform footnote, RAG analogy, QBAF citations
- **Results/Evaluation** (`results-section.tex`): Matches Overleaf lines 143-183, including 206-thread footnote, temporal cutoff, all citations
- **Conclusion** (`conclusion-section.tex`): Matches Overleaf lines 186-192 (anonymity note removed, ends on future work)
- **Limitations** (`limitations-section.tex`): Content matches Overleaf lines 196-202 (prose version)
- **Appendix** (`appendix-section.tex`): Matches Overleaf lines 218-289 (condensed 1-page version)

## Issues Found

### 1. Ethical Considerations — placeholder text
- **Overleaf (lines 205-206)**: Still contains ACL template boilerplate
- **Local**: No `ethical-considerations-section.tex` exists yet; only `ethics-notes.md` draft
- **Action needed**: Write actual ethical considerations content

### 2. Acknowledgments in review version
- **Overleaf (lines 208-209)**: Contains `\section*{Acknowledgments}` with content: "The code used for this project was created with the use of LLMs..."
- **ACL guidelines**: "Do not include [acknowledgments] in review versions"
- **Action needed**: Remove or comment out acknowledgments section for review submission, or verify that the `[review]` option in the acl package suppresses it automatically

### 3. Limitations section numbering
- **Overleaf (line 196)**: Uses `\section{Limitations}` (numbered)
- **Local file**: Uses `\section*{Limitations}` (unnumbered)
- **Note**: The ACL template may handle this automatically (rendering it unnumbered despite `\section{}`). Check the PDF output — in the last PDF it appeared unnumbered, so likely fine.

### 4. Ethical Considerations numbering
- **Overleaf (line 205)**: Uses `\section{Ethical Considerations}` — renders as "5 Ethical Considerations" in PDF
- **Should be**: Unnumbered section per ACL guidelines
- **Action needed**: Change to `\section*{Ethical Considerations}` or use the ACL-mandated format
