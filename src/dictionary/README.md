# Dictionary data format

`data/pi-ste.json` uses the package-owned format that `schema.ts` defines and Effect Schema validates.

- `formatVersion` identifies incompatible format changes.
- `source` pins the repository, commit, and path from which the data was converted.
- `entries[].unapproved` lists exact case-insensitive word forms or phrases.
  Forms can contain letters, numbers, internal apostrophes, internal hyphens, and horizontal whitespace between words.
- `entries[].suggestions` lists approved alternatives.
- `entries[].partsOfSpeech`, when present, lists the POS tags for which the forms are unapproved.

The rule checks an entry with `partsOfSpeech` only when an injected tagger returns one of those tags.
The rule checks an entry without `partsOfSpeech` by word or phrase alone.
The bundled data contains only the `dictionary/not-approved-word` entries from the pinned pi-ste `word_entries()` and `phrase_entries()` functions.
See [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for exact source and license details.
