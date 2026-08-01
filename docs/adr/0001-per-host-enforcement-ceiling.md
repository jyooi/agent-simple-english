# Per-host enforcement ceilings instead of cross-host parity

We design adapters for pi and Claude Code.
Each adapter uses the strongest enforcement that its host allows.
We do not reduce all hosts to one common enforcement level or limit new hosts to warnings.

The host ceilings differ.
Pi gets prompt rules, write and edit gates, commit gates, reply feedback, and strict reply gates.
Claude Code gets prompt rules through SessionStart and write, edit, and commit gates through PreToolUse.
Claude Code has no reply check or strict mode.
We accept and document the host differences.

A host ceiling can increase when its extension surface changes.

Codex support is deferred, not designed around: its hook system is feature-flagged, intercepts only the Bash tool, and cannot gate `apply_patch` file writes, so its ceiling today is too low to justify an adapter.
Revisit when Codex hooks stabilize; under this decision that is a new adapter, not a redesign.
