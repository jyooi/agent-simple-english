# pi-simple-english

A pi extension that makes the pi coding agent comply with ASD-STE100 Simplified Technical English, plus a standalone `simple-english` CLI exposing the same rule engine.

Reimplementation of [pi-ste](https://github.com/ctotheameron/pi-ste) in TypeScript with Effect.

## CLI

```sh
simple-english README.md
cat notes.md | simple-english
simple-english --json README.md
```

Prints STE violations with line, column, and rule id.
Exits 1 when hard violations exist, 0 when no hard violations exist, and 2 when a file cannot be read or a config file is invalid.
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

## Development

```sh
bun install
bun run test
bun run lint
bun run typecheck
```

## License

MIT
