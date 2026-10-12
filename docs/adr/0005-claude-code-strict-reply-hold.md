# Claude Code strict reply hold through a hooks module

ADR 0001 recorded a redaction limit.
Claude Code showed streamed reply text before the `Stop` hook could check it.
Claude Code 2.1.296 lets the hooks module of a plugin read the pieces of each model step in a `turn.step` hook.
The pieces that the hook yields are the only reply text that Claude Code shows and stores.
This decision uses that hook to remove the redaction limit in strict mode.

The plugin needs Claude Code 2.1.296 or later.
We keep no path for earlier versions, because one supported host version keeps the Adapter small.

In strict mode, the `turn.step` hook reads all pieces of a main conversation step and yields nothing during the read.
It sends the text to the `reply-check` subcommand, which runs the same lint as the `Stop` command hook.
A hooks module has no Node.js APIs and can import only relative files, so it starts the CLI for the lint.
If the text has no hard violation, the hook yields the pieces unchanged.
If the text has a hard violation, the hook yields one notice in place of the text.
It keeps the text and the violation details for the `Stop` event.

The `classic.Stop` hook of the module then blocks the `Stop` event.
The block reason gives the held text and the violation details to the model, which writes the reply again.
We selected this path and not a side request with `$.model.complete`.
The main model has the full conversation, so the rewrite keeps the technical content, and the model reads its violations.
The pi Adapter uses the same contract through its `say` tool.

The hook does not call the lower `Stop` hooks when it blocks.
Claude Code prints each block reason below its summary of the `Stop` command hooks.
That print showed the held text in a test, and the summary appears only when a lower hook runs.
The lower hooks run at the `Stop` event of the reply that the user sees.

The module blocks a maximum of two replies in one turn, and Claude Code then shows the next reply unchanged.
Claude Code accepts a block when `stop_hook_active` is true, so the module counts the blocks.
We did not select a notice that stays until a rewrite passes.
A rule that the model cannot satisfy would then hide every reply.

The hold fails open.
If the reply check fails, the hook yields the original pieces and logs one warning, as Hook mode does for an operational failure.
The error handler of the hook makes the reply again from the step result.
Thus, a hook failure or a hook timeout does not lose a reply.
After an interrupt, the hook yields nothing, because the check cannot run and unchecked text must not show.

The hook passes subagent steps on.
It reads the strict flag from the session state file.
The file format and path in ADR 0002 are thus a contract between the CLI and the module.

The hold has these limits.
Strict mode shows no streamed text, because a held reply appears only when it is complete.
The transcript and the `stream-json` output contain the held text in the feedback message for the model.
We did not test managed `Stop` hooks, which run above the module.
The `Stop` command hook stays as a second layer for a reply that showed after a failed reply check.
