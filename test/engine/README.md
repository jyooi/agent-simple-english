# Engine rule accuracy audit

The registry in `src/engine/rules/registry.ts` is the source for rule IDs.
Each rule needs a direct true-positive test, a direct false-positive test, and a boundary test.
Use the test names below to find each case.
All cells must stay at Yes.

| Rule ID | True positive | False positive | Boundary |
| --- | --- | --- | --- |
| `contraction` | Yes. `flags a contraction as a hard violation with its position`. | Yes. `does not flag plain prose`. | Yes. `does not flag a possessive`. |
| `dictionary-not-approved-word` | Yes. `flags an unapproved word as hard and suggests its approved alternative`. | Yes. `does not flag approved alternatives`. | Yes. `uses POS metadata to allow a noun and reject the same word as a verb`. |
| `hedging` | Yes. `flags a hedge phrase as a soft violation`. | Yes. `does not flag plain prose that mentions notes`. | Yes. `does not match within a token`. |
| `marketing` | Yes. `flags a marketing word as a soft violation with its position`. | Yes. `does not flag words that merely contain a listed word`. | Yes. `flags complete hyphenated marketing compounds`. |
| `paragraph-length` | Yes. `flags a paragraph over 6 sentences as a hard violation`. | Yes. `a blank line ends a paragraph`. | Yes. `does not flag a paragraph of exactly 6 sentences`. |
| `phrasal-verb` | Yes. `flags a phrasal verb as a hard violation with the approved alternative`. | Yes. `does not flag the bare verb without its particle`. | Yes. `does not match within a token`. |
| `semicolon` | Yes. `flags a semicolon as a hard violation at its column`. | Yes. `does not flag text without semicolons`. | Yes. `flags semicolons inside inline code`. |
| `sentence-length` | Yes. `flags a sentence over 25 words as a hard violation`. | Yes. `does not flag short sentences`. | Yes. `does not flag a sentence of exactly 25 words`. |
| `verb-progressive` | Yes. `flags progressive tense as a hard violation`. | Yes. `does not flag simple present as progressive`. | Yes. `does not flag an adjective that ends in ing as progressive`. |
| `verb-passive` | Yes. `flags passive voice as a soft violation with a rewrite hint`. | Yes. `does not flag active voice`. | Yes. `detects passive across an intervening adverb`. |
| `verb-perfect` | Yes. `flags perfect tense as a hard violation`. | Yes. `does not flag simple past as perfect`. | Yes. `does not flag main-verb have`. |

Diff-only behavior has a separate engine seam in `diff-match.test.ts`.
Tests at that seam call `newFindings` directly.
