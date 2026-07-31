# Per-host enforcement ceilings instead of cross-host parity

We support multiple hosts (pi, Claude Code), and each adapter implements the strongest enforcement its host's extension surface allows, rather than degrading every host to a lowest common denominator or making new hosts advisory-only.
Concretely: pi gets all five behaviors (prompt rules, write/edit gate, commit gate, reply feedback, strict reply gating); Claude Code gets prompt rules via a SessionStart hook, write/edit/commit gates via PreToolUse hooks, reply feedback via UserPromptSubmit injection, and strict mode approximated by a Stop hook that blocks and forces a rewrite (no redaction of already-streamed text).
The uneven capability across hosts is accepted and documented per host; ceilings rise as host surfaces improve.

Codex support is deferred, not designed around: its hook system is feature-flagged, intercepts only the Bash tool, and cannot gate `apply_patch` file writes, so its ceiling today is too low to justify an adapter.
Revisit when Codex hooks stabilize; under this decision that is a new adapter, not a redesign.
