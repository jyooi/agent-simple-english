# agent-simple-english

Coding agents use this lint engine to enforce technical and house-style writing rules.
One agent-agnostic engine.
One adapter per host.

## Language

**Engine**:
The pure, synchronous lint core that turns text into a report of violations.
_Avoid_: linter core, checker

**Host**:
A coding agent runtime that enforces writing rules with the Engine.
Current hosts: pi and Claude Code.
_Avoid_: platform, agent (ambiguous with the LLM itself), IDE

**Adapter**:
The per-host integration layer that wires the engine into that host's extension surface (pi extension, Claude Code plugin).
_Avoid_: plugin (that is the Claude Code artifact name, not the concept), integration

**Enforcement ceiling**:
The strongest set of writing-rule behaviors a host's extension surface allows.
Each Adapter implements writing-rule behaviors up to its Host's ceiling.
Adapters do not need parity across Hosts.

**Hook mode**:
The CLI mode that speaks a host's hook protocol: hook event JSON on stdin, hook decision JSON on stdout.
Hosts with hook-based Adapters enforce writing rules when they start the CLI in this mode.

**Gate**:
A check that blocks an action (write, edit, commit, reply) when the text has hard violations.
_Avoid_: guard, filter

**Hard / soft severity**:
A hard violation blocks the gated action.
A soft violation only produces a warning.

**Strict mode**:
The mode that applies the host's strongest available reply gate to hard violations.
Host support follows the [per-host enforcement ceilings](docs/adr/0001-per-host-enforcement-ceiling.md).

**Observation**:
One logged record of one lint decision at an enforcement boundary.
An Observation embeds zero or more Findings.
_Avoid_: log entry, event (too generic)

**Finding**:
One violation as captured inside an Observation, with a stable identity for later review.
A Finding is the reviewable copy of an engine violation.
_Avoid_: hit, match

**Verdict**:
A human judgment on one Finding: true positive or false positive.
Verdicts are separate records.
The latest Verdict for a Finding wins.

**False positive**:
A Finding whose latest Verdict says the rule fired incorrectly.
Without a Verdict, a Finding is unjudged, not a false positive.
