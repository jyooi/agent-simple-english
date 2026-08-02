# Dictionary data format

The JSON files in `data/` use the package-owned format that `schema.ts` defines and Effect Schema validates.
The CLI and Adapters load all bundled data through `load.ts`.
The bundled dictionary and rule-data files use the not-approved form.
A user-owned approved-word list uses the approved form.

## Shared fields

- `formatVersion` identifies incompatible format changes.
- `source.name` gives the source name.
- `source.repository`, `source.commit`, and `source.path` record the source location and revision.

Use private source identifiers when license restrictions apply.
Unknown properties cause validation to fail.

## Not-approved dictionary

- `entries[].unapproved` lists exact case-insensitive word forms or phrases.
  Forms can contain letters, numbers, internal apostrophes, internal hyphens, and horizontal whitespace between words.
- `entries[].suggestions` is a required list of rule responses.
  The dictionary rule reports all values as approved alternatives, the phrasal-verb rule uses the first value, and the hedging and marketing rules ignore this field.
- `entries[].partsOfSpeech`, when present, lists the POS tags for which the forms are unapproved.
  Only the `dictionary-not-approved-word` rule uses this field.

For the `dictionary-not-approved-word` rule, matching is token based.
A hyphenated form matches only that exact hyphenated token.
A phrase can span horizontal whitespace or a soft line break in the same Markdown paragraph, but it cannot span Markdown block boundaries or hard line breaks.
Fenced and indented Markdown code is excluded from matching.
The rule checks an entry with `partsOfSpeech` only when an injected tagger returns one of those tags for the form's first token.
The rule checks an entry without `partsOfSpeech` by word or phrase alone.
The root [README](../../README.md) documents match details for the three list-backed rules and their config extension paths.

## Approved-word list

An approved-word list replaces `entries` with one `approvedWords` array:

```json
{
  "formatVersion": 1,
  "source": {
    "name": "your licensed source",
    "repository": "your private source location",
    "commit": "your licensed revision",
    "path": "your extraction record"
  },
  "approvedWords": ["your-approved-form"]
}
```

The example contains a synthetic placeholder and no ASD dictionary data.
`approvedWords` must contain at least one item.
Each item must be one exact token in the same token format as a not-approved dictionary form.
Phrases are not valid approved-word items.
The rule compares each prose token with the list without regard to case.

The rule does not infer roots, lemmas, plurals, or other forms.
Add each permitted word form as a separate item.
The rule excludes identifiers, Markdown link destinations, and fenced or indented Markdown code before this check.

Set `approvedWordsPath` in the Simple English config to select this mode.
The configured list has precedence over the bundled not-approved sample and `SIMPLE_ENGLISH_DICTIONARY`.
The pure engine receives validated dictionary data and does not read this file.

See [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for the bundled data source, conversion scope, and license details.
