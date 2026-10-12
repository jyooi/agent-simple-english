# Per-host enforcement ceilings instead of cross-host parity

We design adapters for pi and Claude Code.
Each adapter uses the strongest enforcement that its host allows.
We do not reduce all hosts to one common enforcement level or limit new hosts to warnings.

The host ceilings differ.
Pi gets prompt rules, write and edit gates, commit gates, reply feedback, and strict reply gates.
Claude Code gets prompt rules through SessionStart and write, edit, and commit gates through PreToolUse.
It gets deferred reply feedback through Stop and UserPromptSubmit.

Its strict mode holds reply text in a hooks module until the reply has no hard violation.
[ADR 0005](0005-claude-code-strict-reply-hold.md) defines that hold and replaces the redaction limit that this decision recorded before.
The pi Adapter hides strict reply text until approval through its `say` tool.
The two hosts differ after repeated blocked rewrites: Claude Code then shows the reply, and pi keeps it hidden.
We accept and document this enforcement ceiling difference.

A host ceiling can increase when its extension surface changes.
[ADR 0002](0002-claude-code-reply-feedback.md) defines the Claude Code reply feedback design.

Codex support is deferred, not designed around: its hook system is feature-flagged, intercepts only the Bash tool, and cannot gate `apply_patch` file writes, so its ceiling today is too low to justify an adapter.
Revisit when Codex hooks stabilize; under this decision that is a new adapter, not a redesign.
