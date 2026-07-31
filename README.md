# pi-simple-english

A pi extension that makes the pi coding agent comply with ASD-STE100 Simplified Technical English, plus a standalone `simple-english` CLI that exposes the same rule engine.

This project is a TypeScript and Effect reimplementation of [pi-ste](https://github.com/ctotheameron/pi-ste).

## CLI

```sh
simple-english README.md
simple-english src/main.ts
git log -1 --format=%B | simple-english --kind commit-message
cat notes.md | simple-english
simple-english --json README.md
```

The CLI selects a content kind from each file extension:

- `slash-source` lints comments in `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.go`, `.rs`, `.java`, `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cs`, `.swift`, `.kt`, and `.scala` files.
- `hash-source` lints comments in `.sh`, `.bash`, `.zsh`, `.py`, `.rb`, `.yaml`, `.yml`, `.toml`, and `.pl` files.
- `prose-file` lints all other files, including extensionless paths.

Extension matching is case-insensitive.
Standard input defaults to `prose-file`.
Use `--kind prose-file`, `--kind slash-source`, `--kind hash-source`, or `--kind commit-message` to override automatic selection for files or standard input.
The `commit-message` kind lints the complete commit message.

All kinds preserve original line and column positions and ignore identifiers plus Markdown fenced and indented code.
Inline code is excluded from all rules except `semicolon`.
Source kinds lint only comments and ignore comment markers inside string literals.

The CLI prints STE violations with a line, column, severity, and rule ID.
It exits 1 when hard violations exist, 0 when no hard violations exist, and 2 for input, argument, or config errors.
Soft violations are still printed when the command exits 0.
`--json` emits a machine-readable report with the severity of each violation and an approved suggestion for phrasal verbs.
`--config <path>` loads an explicit config file instead of the discovered ones.

## Rules

| Rule ID | Severity | Default |
| --- | --- | --- |
| `sentence-length` | Hard | More than 25 words in one sentence |
| `paragraph-length` | Hard | More than 6 sentences in one paragraph |
| `contraction` | Hard | Contractions |
| `semicolon` | Hard | Semicolons |
| `phrasal-verb` | Hard | Curated phrasal verbs, with an approved single-verb suggestion |
| `hedging` | Soft | Curated hedging phrases |
| `marketing` | Soft | Curated marketing language |
| `dictionary-not-approved-word` | Hard | Unapproved dictionary words and phrases |
| `verb-progressive` | Hard | Progressive verb forms |
| `verb-passive` | Soft | Passive voice |
| `verb-perfect` | Hard | Perfect verb forms |

Fenced code blocks are excluded from all rules.
Inline code is excluded from the mechanical and list rules except `semicolon`.
Hedging, marketing, and phrasal-verb multiword matches stay within one line.

## Configuration

Config is an optional JSON object.
The global file lives at `simple-english.json` in the pi agent config directory, which defaults to `~/.pi/agent` and honors `PI_CODING_AGENT_DIR`.
An optional per-project file at `.pi/simple-english.json` deep-merges over it, with the project value winning per key.

```json
{
  "rules": {
    "sentence-length": "soft"
  },
  "maxSentenceWords": 20
}
```

Every rule can be set to `hard` (violations fail the run), `soft` (violations are reported but do not fail the run), or `off`.
`maxSentenceWords` tunes the sentence-length cap and must be a positive integer (default 25).
Config is validated: an unknown rule name, a bad severity or tunable value, or an unknown key produces a readable error, never a silent fall-back to defaults.

## Dictionary

The package includes a bundled list of unapproved words and phrases.
Dictionary violations are hard by default and include the approved alternative as a suggestion.
Effect Schema validates the package-owned format when the dictionary loads, while the lint engine receives decoded data and stays pure and synchronous.
POS metadata limits an entry to the applicable use when the injected tagger is available.
Entries without POS metadata use word-level matching.

Set `SIMPLE_ENGLISH_DICTIONARY` to a replacement file that uses the documented [dictionary data format](src/dictionary/README.md).
If that file cannot be read or validated, the CLI prints a dictionary error and continues with all other lint rules.

## Attribution

The bundled dictionary is converted from the MIT-licensed [`ctotheameron/pi-ste`](https://github.com/ctotheameron/pi-ste) project.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the exact pinned source, conversion scope, and ASD-STE100 redistribution note.

## Development

```sh
bun install
bun run test
bun run lint
bun run typecheck
```

## License

MIT
