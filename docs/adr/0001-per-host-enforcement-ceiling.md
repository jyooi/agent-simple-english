# Per-host enforcement ceilings instead of cross-host parity

We design adapters for pi and Claude Code.
Each adapter uses the strongest enforcement that its host allows.
We do not reduce all hosts to one common enforcement level or limit new hosts to warnings.

The host ceilings differ.
Pi gets prompt rules, write and edit gates, commit gates, reply feedback, and strict reply gates.
Claude Code gets prompt rules through SessionStart and write, edit, and commit gates through PreToolUse.
It gets deferred reply feedback through Stop and UserPromptSubmit.
Its strict mode can block a completed reply at Stop and cause one immediate rewrite.
Claude Code streams the reply before Stop, so the Adapter cannot redact text that the host already showed.
The pi Adapter can hide strict reply text until approval through its `say` tool.
We accept and document this enforcement ceiling difference.

A host ceiling can increase when its extension surface changes.
[ADR 0002](0002-claude-code-reply-feedback.md) defines the Claude Code reply feedback design.

Codex support is deferred, not designed around: its hook system is feature-flagged, intercepts only the Bash tool, and cannot gate `apply_patch` file writes, so its ceiling today is too low to justify an adapter.
Revisit when Codex hooks stabilize; under this decision that is a new adapter, not a redesign.
