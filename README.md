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
Exits 1 when hard violations exist, 0 when clean, 2 when a file cannot be read.
`--json` emits a machine-readable report.

## Development

```sh
bun install
bun run test
bun run lint
bun run typecheck
```

## License

MIT
