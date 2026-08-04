# Local observation log with human verdicts for false-positive measurement

We add an observation layer that records every hook-mode lint decision to a local append-only log.
A false positive is a human judgment, not a machine inference.
The log records Observations and Findings, and a person attaches Verdicts later through `observe review`.
`observe stats` reports per-rule fire counts, judged counts, and the false-positive rate among judged Findings.

## Shape

Observations go to `~/.local/state/simple-english/observations/YYYY-MM.jsonl`, one JSON line per lint decision.
Each Observation carries id, timestamp, surface, event, session id, cwd, path, kind, decision, a text hash, and embedded Findings.
Each Finding carries the rule id, severity, message, position, and the offending snippet, so review needs no archaeology in git history.
Verdicts are separate append-only records in `verdicts.jsonl` that reference an Observation id and Finding index.
The latest Verdict for a Finding wins.

## Boundaries

Only hook-mode gates write Observations: write, edit, commit-message, and reply checks.
Plain CLI runs and corpus sweeps stay silent, because bulk runs over ungated documents would skew the rates.
A `surface` field exists from day one, so the pi Adapter can adopt the log as a new field value.
The Engine stays pure.
The only engine change exposes the offending snippet on each violation.
Logging happens after the decision and can never alter it, and the logger swallows its own failures.

## Rejected alternatives

We rejected inferred verdicts from proxy signals (deny-then-retry patterns, session toggles) as the primary mechanism.
Wrong inference would poison the false-positive counts, which are the numbers this layer must make trustworthy.
The single event stream keeps deny-retry sequences adjacent, so proxy signals stay possible as a later, additive analysis.
We rejected in-place verdict fields on the log because mutation breaks append-only semantics under concurrent hook writes.
We rejected per-project log files because the usage question is cross-project, and records already carry cwd for slicing.

Logging is on by default with a `SIMPLE_ENGLISH_OBSERVE=0` kill switch.
The log includes soft findings, and they are reviewable.
The log includes reply checks even outside strict mode.
See `CONTEXT.md` for the Observation, Finding, Verdict, and false-positive vocabulary.
