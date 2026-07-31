# Dictionary data format

`data/pi-ste.json` uses the package-owned format that `schema.ts` defines and Effect Schema validates.

- `formatVersion` identifies incompatible format changes.
- `source` records the source name and pins the repository, commit, and path from which the data was converted.
- `entries[].unapproved` lists exact case-insensitive word forms or phrases.
  Forms can contain letters, numbers, internal apostrophes, internal hyphens, and horizontal whitespace between words.
- `entries[].suggestions` lists approved alternatives.
- `entries[].partsOfSpeech`, when present, lists the POS tags for which the forms are unapproved.

Unknown properties and unsupported form syntax cause dictionary validation to fail.
Matching is token based, and a hyphenated form matches only that exact hyphenated token.
A phrase can span horizontal whitespace or a soft line break in the same Markdown paragraph, but it cannot span Markdown block boundaries or hard line breaks.
Fenced and indented Markdown code is excluded from matching.
The rule checks an entry with `partsOfSpeech` only when an injected tagger returns one of those tags for the form's first token.
The rule checks an entry without `partsOfSpeech` by word or phrase alone.
See [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for the bundled data's exact source, conversion scope, and license details.
