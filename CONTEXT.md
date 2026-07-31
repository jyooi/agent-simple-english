# Simple English (STE) Toolkit

A lint engine for ASD-STE100 Simplified Technical English, enforced inside coding agents.
One agent-agnostic engine; one adapter per host.

## Language

**Engine**:
The pure, synchronous lint core that turns text into a report of violations.
_Avoid_: linter core, checker

**Host**:
A coding agent runtime the engine is enforced in.
Current hosts: pi and Claude Code.
_Avoid_: platform, agent (ambiguous with the LLM itself), IDE

**Adapter**:
The per-host integration layer that wires the engine into that host's extension surface (pi extension, Claude Code plugin).
_Avoid_: plugin (that is the Claude Code artifact name, not the concept), integration

**Enforcement ceiling**:
The strongest set of STE behaviors a host's extension surface allows.
Adapters implement up to their host's ceiling; parity across hosts is not required.

**Hook mode**:
The CLI mode that speaks a host's hook protocol: hook event JSON on stdin, hook decision JSON on stdout.
Hosts whose adapters are hook-based (Claude Code) enforce STE by spawning the CLI in this mode.

**Gate**:
A check that blocks an action (write, edit, commit, reply) when the text has hard violations.
_Avoid_: guard, filter

**Hard / soft severity**:
A hard violation blocks the gated action; a soft violation only produces a warning.

**Strict mode**:
The reply-gating mode where the assistant's user-facing prose is checked before the user reads it.
On pi this uses the `say` tool with redaction; other hosts approximate it up to their ceiling.
