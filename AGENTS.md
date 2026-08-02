# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## What this project is

A host-neutral ASD-STE100 Simplified Technical English toolkit in TypeScript and Effect.
It supplies a pure Engine, a standalone `simple-english` CLI (`src/cli/main.ts`), and a pi Adapter.
Behavioral reference: https://github.com/ctotheameron/pi-ste (Gleam) - this is a reimplementation, not a fork.
Parent spec lives in Linear HUF-130.

## Architecture rules (binding, from the HUF-130 spec)

- Pure functional core: `src/engine/` is synchronous, and `src/engine/lint.ts` orchestrates it.
  Effect stays at boundaries such as CLI IO, config loading, and schema validation and loading.
- New rules must register their id in `src/engine/rules/registry.ts`; the config schema derives valid rule names from it, so unregistered ids are rejected in user config.
- Three primary test seams cover product behavior: pure engine API (`test/engine/`), CLI E2E via spawned `bun src/cli/main.ts` (`test/cli/`), and extension wiring via a stubbed ExtensionAPI double. Never run pi itself in tests.
- Rule-accuracy tests grow first at the pure engine seam. Each lint rule must have direct finding, clean, and boundary cases listed in `test/engine/README.md`.
- Severity model: violations carry `hard`/`soft`; hard violations drive CLI exit code 1.
- TDD per rule: failing engine-seam test first, then implement.
- pi installs extension deps with `npm install --omit=dev` from the package.json next to the entry point, so runtime deps (e.g. `effect`, `wink-nlp`) must stay in `dependencies`, never `devDependencies`.
- POS tagging is an injected boundary: the engine consumes the pure `Tagger` type (`src/engine/tagger.ts`) and silently skips tagger-dependent checks when `LintOptions.tagger` is absent; the wink-nlp implementation and its Effect layer live in `src/tagger/wink.ts`. Tagger-dependent verb verdicts are pinned, right or wrong, in `test/engine/verb-form-fixtures.test.ts`.
- The package-owned dictionary format and matching semantics are documented in `src/dictionary/README.md`; load and validate dictionary data before passing it into the synchronous engine.
- Extractors (`src/engine/comments.ts`, `markdown.ts`, `identifiers.ts`) blank non-prose with spaces so violation line/column always map to the original file. `test/fixtures/**` is excluded from Biome because tests pin exact byte positions in fixtures; do not let a formatter touch them.

## Commands

- `bun run test` (Vitest), `bun run lint` (Biome), `bun run typecheck` (tsc). CI (`.github/workflows/ci.yml`) runs all three on bun 1.3.14.

## Agent skills

### Issue tracker

Issues live in Linear, team Huffman (`HUF`), via the Linear MCP tools. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles map 1:1 to Linear label names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: glossary in `CONTEXT.md` at the root, decisions in `docs/adr/`. See `docs/agents/domain.md`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
