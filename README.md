# pi-simple-english

A pi extension that makes the pi coding agent comply with ASD-STE100 Simplified Technical English, plus a standalone `simple-english` CLI that exposes the same rule engine.

This project is a TypeScript and Effect reimplementation of [pi-ste](https://github.com/ctotheameron/pi-ste).

## CLI

```sh
simple-english README.md
cat notes.md | simple-english
simple-english --json README.md
```

The CLI prints STE violations with a line, column, and rule ID.
It exits 1 when hard violations exist, 0 when no hard violations exist, and 2 when an input file cannot be read or a config file is invalid.
Soft violations are still printed when the command exits 0.
`--json` emits a machine-readable report.
`--config <path>` loads an explicit config file instead of the discovered ones.

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

The package vendors the widely cited unapproved word and phrase pairs from pi-ste in `src/dictionary/data/pi-ste.json`.
Each violation is hard and includes the approved alternative as a suggestion.
Effect Schema validates the package-owned format when the dictionary loads, while the lint engine receives decoded data and stays pure and synchronous.
POS metadata limits an entry to the applicable use when the injected tagger is available.
Entries without POS metadata use word-level matching.

Set `SIMPLE_ENGLISH_DICTIONARY` to another file in the same format to test or supply replacement data.
If that file cannot be read or validated, the CLI prints a dictionary error and continues with all other lint rules.

## Attribution

The vendored dictionary data is converted from [`ctotheameron/pi-ste`](https://github.com/ctotheameron/pi-ste) at commit `18a8cc686be2cc0e680705daf2327fb0d1ef93ce` and is used under the MIT License.
The upstream attribution and ASD-STE100 redistribution note are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development

```sh
bun install
bun run test
bun run lint
bun run typecheck
```

## License

MIT
