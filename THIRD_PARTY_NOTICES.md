# Third-party notices

## Vendored STE dictionary data

`src/dictionary/data/pi-ste.json` is a data-only conversion of the entries returned by `word_entries()` and `phrase_entries()` with the `dictionary/not-approved-word` rule ID in [`ctotheameron/pi-ste`](https://github.com/ctotheameron/pi-ste), `src/ste/dictionary.gleam`, at commit `18a8cc686be2cc0e680705daf2327fb0d1ef93ce`.
The `package.json` at that commit declares the package to be MIT licensed, and its README also states that the license is MIT.
No other pi-ste lists or upstream implementation code are included.

The conversion expands the upstream spelling generators into explicit forms.
Forms produced by upstream verb helpers have `VERB` metadata.
Entries without source POS metadata use word-level matching.

The pinned source states that ASD owns ASD-STE100, limits redistribution of the full dictionary, and describes these entries as widely cited pairs.
