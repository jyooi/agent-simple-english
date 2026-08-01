# Claude Code reply feedback through deferred injection

ADR 0001 states that the Claude Code Adapter has no reply check.
Claude Code now supplies `Stop` and `UserPromptSubmit` hooks that increase its enforcement ceiling.
This decision replaces that part of ADR 0001.
Strict reply gates remain outside the current ceiling.

The `Stop` hook reads the last assistant message from the Claude Code transcript.
It checks the reply and records only hard violation feedback.
It does not block or change the completed reply.

The `UserPromptSubmit` hook adds pending feedback to the next model context.
It removes the feedback before it returns, so concurrent calls cannot add the same feedback two times.
Soft violations never enter the saved feedback.

Session state uses one file for each Claude Code session.
Files are under `$XDG_STATE_HOME/simple-english/sessions`, with `~/.local/state` as the default state root.
A SHA-256 key from the session ID gives safe, fixed-length file names.
State writes use a temporary file and an atomic rename.
Feedback reads claim the file with an atomic rename before removal.

This design keeps feedback separate for concurrent sessions in the same project.
It also gives later Adapter work one state location for session mode data.
State and transcript failures allow the hook event and give a warning.
