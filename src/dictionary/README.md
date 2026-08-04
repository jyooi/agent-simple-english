# Dictionary data format

The JSON files in `data/` use the package-owned format that `schema.ts` defines and Effect Schema validates.
The CLI and Adapters load all bundled data through `load.ts`.
The bundled dictionary and rule-data files use the not-approved form.
The adjectival-participle rule data interprets its forms as allowed exceptions.
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
  The dictionary rule reports all values as approved alternatives, the phrasal-verb rule uses the first value, and the hedging, marketing, and adjectival-participle checks ignore this field.
- `entries[].partsOfSpeech`, when present, lists the POS tags for which the forms are unapproved.
  Only the `dictionary-not-approved-word` rule uses this field.

For `adjectival-participle` rule data, each `entries[].unapproved` value represents one allowed tagged-token surface form.
Matching is exact and case-insensitive.

For the `dictionary-not-approved-word` rule, matching is token based.
A hyphenated form matches only that exact hyphenated token.
A phrase can span horizontal whitespace or a soft line break in the same Markdown paragraph, but it cannot span Markdown block boundaries or hard line breaks.
Fenced and indented Markdown code and valid GFM tables are excluded from matching.
The rule checks an entry with `partsOfSpeech` only when an injected tagger returns one of those tags for the form's first token.
The rule checks an entry without `partsOfSpeech` by word or phrase alone.
The root [README](../../README.md) owns user-facing matching behavior and configuration.

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
A listed hyphenated form approves only that exact hyphenated token.

The rule checks visible Markdown prose, including link and image labels.
It excludes identifiers, valid GFM tables, Markdown code, link destinations and reference definitions, autolinks, character references, and HTML syntax.
It also excludes raw content in `pre`, `script`, `style`, and `textarea` HTML flow blocks.

See the root [Configuration](../../README.md#configuration) section for list selection, precedence, and load errors.
The pure engine receives validated dictionary data and does not read this file.

See [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for the third-party bundled dictionary source, conversion scope, and license details.
