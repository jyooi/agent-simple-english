# Claude Code reply feedback through deferred injection

ADR 0001 defines the per-host enforcement ceiling policy.
The `Stop` and `UserPromptSubmit` hooks increase the Claude Code enforcement ceiling.
This decision adds deferred reply feedback to that ceiling.
The later session-controls slice adds a strict Stop gate.
ADR 0001 records its redaction limit.

The `Stop` hook reads `last_assistant_message` from the event.
This event field is authoritative because the transcript can lag behind the completed reply.
When the field is present, the latest user transcript record gives the reply turn identity.
When the field is absent, the latest assistant transcript entry gives the reply and its identity.
It checks the reply and records only hard violation feedback.
Session state retains the processed reply turn identity and ignores duplicate `Stop` events.
In non-strict mode, it does not block or change the completed reply.

The `UserPromptSubmit` hook adds pending feedback to the next model context.
It removes the feedback before it returns, so concurrent calls cannot add the same feedback two times.
Soft violations never enter the saved feedback.

Session state uses one file for each Claude Code session.
Files are under `$XDG_STATE_HOME/simple-english/sessions`, with `~/.local/state` as the default state root.
A SHA-256 key from the session ID gives safe, fixed-length file names.
State writes use a temporary file and an atomic rename.
Feedback reads claim the file with an atomic rename before they clear pending feedback.

This design keeps feedback separate for concurrent sessions in the same project.
It also gives later Adapter work one state location for session mode data.
State and transcript failures allow the hook event and give a warning.
