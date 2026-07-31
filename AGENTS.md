# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## What this project is

A pi extension (TypeScript + Effect) that makes the pi coding agent comply with ASD-STE100 Simplified Technical English, plus a standalone `simple-english` CLI (`src/cli/main.ts`) exposing the same rule engine.
Behavioral reference: https://github.com/ctotheameron/pi-ste (Gleam) - this is a reimplementation, not a fork.
Parent spec lives in Linear HUF-130.

## Architecture rules (binding, from the HUF-130 spec)

- Pure functional core: the `lint` engine (`src/engine/lint.ts`) is synchronous, no Effect runtime. Effect only at boundaries (CLI IO, config loading and Schema decoding in `src/config/`; layers later).
- New rules must register their id in `src/engine/rules/registry.ts`; the config schema derives valid rule names from it, so unregistered ids are rejected in user config.
- Three test seams only: pure engine API (~90% of suite, `test/engine/`), CLI E2E via spawned `bun src/cli/main.ts` (`test/cli/`), extension wiring via stubbed ExtensionAPI double. Never run pi itself in tests.
- Severity model: violations carry `hard`/`soft`; hard violations drive CLI exit code 1.
- TDD per rule: failing engine-seam test first, then implement.
- pi installs extension deps with `npm install --omit=dev` from the package.json next to the entry point, so runtime deps (e.g. `effect`, `wink-nlp`) must stay in `dependencies`, never `devDependencies`.
- POS tagging is an injected boundary: the engine consumes the pure `Tagger` type (`src/engine/tagger.ts`) and silently skips verb-form rules when `LintOptions.tagger` is absent; the wink-nlp implementation and its Effect layer live in `src/tagger/wink.ts`. Tagger-dependent verdicts are pinned, right or wrong, in `test/engine/verb-form-fixtures.test.ts`.

## Commands

- `bun run test` (Vitest), `bun run lint` (Biome), `bun run typecheck` (tsc). CI (`.github/workflows/ci.yml`) runs all three on bun 1.3.14.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
