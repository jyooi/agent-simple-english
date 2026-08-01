# Claude Code reply feedback through deferred injection

ADR 0001 defines the per-host enforcement ceiling policy.
The `Stop` and `UserPromptSubmit` hooks increase the Claude Code enforcement ceiling.
This decision adds deferred reply feedback to that ceiling.
Session controls add a strict Stop gate.
ADR 0001 records its redaction limit.

The `Stop` hook reads `last_assistant_message` from the event.
This event field is authoritative because the transcript can lag behind the completed reply.
When the field is present, the latest user transcript record gives the base turn identity.
A hash of the event reply identifies each rewrite in that turn.
When the field is absent, the latest assistant transcript entry gives the reply and its identity.
It checks the reply.
In non-strict mode, it records only hard violation feedback.
It does not block or change the completed reply in this mode.
Session state retains the processed reply identity and ignores duplicate `Stop` events.

The `UserPromptSubmit` hook adds pending feedback to the next model context.
It removes the feedback before it returns, so concurrent calls cannot add the same feedback two times.
Soft violations never enter the saved feedback.

Session state uses one file for each Claude Code session.
Files are under `$XDG_STATE_HOME/simple-english/sessions`, with `~/.local/state` as the default state root.
A SHA-256 key from the session ID gives safe, fixed-length file names.
State writes use a temporary file and an atomic rename.
All state access uses one lock directory for each session.

This design keeps feedback separate for concurrent sessions in the same project.
The same state file stores session mode data.
State and transcript failures allow the hook event and give a warning.
