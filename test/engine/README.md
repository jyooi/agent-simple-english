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
| `invalid-suppression` | Yes. `an unknown rule id reports one hard invalid-suppression violation`. | Yes. `whitespace and comma separators can name multiple rules`. | Yes. `a directive with no rule id reports the invalid-suppression violation`. |
| `marketing` | Yes. `flags a marketing word as a soft violation with its position`. | Yes. `does not flag words that merely contain a listed word`. | Yes. `flags complete hyphenated marketing compounds`. |
| `paragraph-length` | Yes. `flags a paragraph over 6 sentences as a hard violation`. | Yes. `counts e.g. and i.e. within four sentences`; `keeps underscore-emphasized %s inside a sentence`. | Yes. `preserves a true boundary after a %s`; `preserves a true boundary after quoted %s`; `does not restore a capital initial from a masked dotted identifier`. |
| `phrasal-verb` | Yes. `flags a phrasal verb as a hard violation with the approved alternative`. | Yes. `does not flag the bare verb without its particle`. | Yes. `does not match within a token`. |
| `semicolon` | Yes. `flags a semicolon as a hard violation at its column`. | Yes. `ignores semicolons inside inline code`. | Yes. `flags a prose semicolon beside inline code at its original column`. |
| `sentence-length` | Yes. `flags an overlong sentence across an abbreviation`. | Yes. `does not flag short sentences`. | Yes. `does not flag 25 words across an abbreviation`. |
| `verb-progressive` | Yes. `flags progressive tense as a hard violation`. | Yes. `does not flag a bundled adjectival participle`. | Yes. `allows a listed participle after an intervening adverb`. |
| `verb-passive` | Yes. `flags passive voice as a soft violation with a rewrite hint`. | Yes. `does not flag an allowlisted passive participle`. | Yes. `detects passive across an intervening adverb`. |
| `verb-perfect` | Yes. `flags perfect tense as a hard violation`. | Yes. `does not flag simple past as perfect`. | Yes. `does not flag main-verb have`. |

## Markdown masking accuracy

Cross-cutting Markdown masks use the same finding, clean, and boundary audit at the Engine seam.

| Feature | Finding | Clean | Boundary |
| --- | --- | --- | --- |
| GFM tables | Yes. `lints prose around a table at its original positions`. | Yes. `masks a valid multi-row GFM table from all prose rules`. | Yes. `does not mask table-like text with mismatched delimiter cells`. |
| YAML frontmatter | Yes. `lints prose after frontmatter at its original position`. | Yes. `masks YAML frontmatter from all prose rules`. | Yes. `does not mask a thematic break in the middle of a document`. |

## Engine options

| Option | Finding | Clean | Boundary |
| --- | --- | --- | --- |
| `exemptBlockQuotes` | Yes. `keeps structural rules active in quoted content`. | Yes. `exempts quoted content from all wording rules`. | Yes. `lints prose outside quotes at its original position`. |

Diff-only behavior has a separate engine seam in `diff-match.test.ts`.
Tests at that seam call `newFindings` directly.
