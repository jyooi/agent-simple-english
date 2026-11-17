---
name: verify-reply-hold
description: Model-check the strict reply hold of the Claude Code Adapter with TLC, and add the State chart part to each PR. Use when a change touches hooks/reply-hold.ts, hooks/register.ts, hooks/hooks.json, evaluateReply in src/cli/hook.ts, or src/cli/reply-check.ts, when you open a PR, or when bun run verify fails.
---

# Verify the strict reply hold

The reply hold keeps strict-mode reply text off the screen until the text has no hard violation.
[ADR 0005](../../../docs/adr/0005-claude-code-strict-reply-hold.md) defines it.
Its most costly bugs come from event orders that tests do not reach.
Such an order mixes a held step, a tool call, a failed check, an interrupt, and two Stop hooks.
`ReplyHold.tla` is a TLA+ model of those events, and TLC checks every order of them within the bounds below.

## Run the check

```sh
bun run verify
```

The check needs Java 11 or later on the `PATH`.
The first run downloads TLC 1.7.4 into `node_modules/.cache/tla2tools/1.7.4/` and checks its SHA-256 against `record.json`.
Set `TLA2TOOLS_JAR` to use another copy of the same file.
The `verify` job of `.github/workflows/verification.yml` runs the same command on each PR.

The check fails in each of these cases, and it names the cause:

1. This skill or `record.json` is missing.
2. A covered file changed, and its SHA-256 in `record.json` did not.
3. TLC finds a violation of a property with the status `holds`, or a recorded finding no longer breaks.
4. TLC does not catch the recorded break of a property with the status `holds`.
5. In CI on a PR, the PR text and the PR comments have no State chart part.

A local run has no PR data, so it does not check case 5.

## Tell if a change touches verified code

`record.json` lists each covered file, the functions in it, and its SHA-256.
The check compares the full file, so any edit of a covered file stops the check until you confirm the model.
Also look for new code that changes the same behavior in other files.
Examples are a new writer of the `turn` record, a new `classic.Stop` or `turn.step` hook, or a new path to the `reply-check` subcommand.

| Covered file | Code that the model describes |
| --- | --- |
| `hooks/reply-hold.ts` | `holdReply`, `restoreReply`, `blockHeldReply`, `replyFeedback`, `strictSession`, `BLOCK_LIMIT`, and the `turn` record |
| `hooks/register.ts` | `register`: `turn.step` with the `restoreReply` error handler, and `classic.Stop` |
| `hooks/hooks.json` | The `Stop` command hook below the module |
| `src/cli/hook.ts` | `evaluateReply`: the strict `Stop` block |
| `src/cli/reply-check.ts` | `runReplyCheck`: feedback only for hard violations |

## Properties

| Property | Status | Rule in plain words | Harm when it breaks |
| --- | --- | --- | --- |
| `HeldTextStaysHidden` | holds | In strict mode, the user never sees reply text with a hard violation, unless the reply check failed or the turn had two Stop blocks. | The user sees text that breaks the writing rules. |
| `RewritesFinite` | holds | A turn has three Stop blocks or fewer. | The model rewrites without end, and the turn never ends. |
| `NoticeIsFollowed` | finding | When a turn ends, the last text on the screen is not the hold notice. | The user sees "A corrected reply follows", and no reply follows. The held text is lost. |
| `RewritesBounded` | finding | A turn has two Stop blocks or fewer, as ADR 0005 states. | After a failed reply check, the model writes one more rewrite than the ADR permits. |

A property with the status `finding` breaks on the current code.
The check expects it to break, and it fails when it stops breaking.
`RewritesFinite` is the bound that the code has now.
It guards against an endless loop, which the `RewritesBounded` finding cannot show.

The `NoticeIsFollowed` path: the model writes a step with a hard violation and a tool call.
The hold shows the notice, and the tool runs.
The model then ends the turn with a step that has no text.
The hold does not block the stop, because it did not hold the last step.

The `RewritesBounded` path: the reply check fails, so the first reply shows unchanged.
The `Stop` command hook blocks the stop.
The hold then holds the first two rewrites and blocks two times, so the turn has three Stop blocks.

Each property with the status `holds` has a recorded break in `record.json`.
The check applies the break to a copy of the model in a temporary folder, and TLC must find the violation.
The break never changes a file in the repository.

## Bounds and assumptions

`ReplyHold.cfg` sets `BlockLimit = 2`, as in the code, `MaxTurns = 2`, and `MaxToolSteps = 2` for each turn.
Each step has no text, clean text, or text with a hard violation, with or without a tool call.
`StateBound` stops the search past three Stop blocks.
It removes no state of the current model, and it lets a broken model end.

The model assumes these facts about Claude Code 2.1.296 or later:

- Each step of one turn has the same turn ID, also each rewrite after a Stop block.
- A new prompt starts a new turn ID.
- After a Stop block in a turn, `stop_hook_active` is true.
- Claude Code sends `Stop` only when a step ends with no tool call, and it sends no `Stop` after an interrupt.
- The reply check and the `Stop` command hook use the same lint, so both find the same hard violations.
- The session stays in strict mode.

## What the check does not cover

- Subagent steps. The hook passes them on and does not change the `turn` record.
- Strict mode off, and a failed read of the session state file, which acts as strict mode off for that step.
- An interrupt during a step that the hook passes on with no check.
- A failed lint in the `Stop` command hook, which allows the stop.
- Text that has only spaces, which the hook treats as no text.
- Lint accuracy and the text of the feedback. The engine tests cover them.
- The route of the `reply-check` subcommand in `src/cli/main.ts`. If that route breaks, each check fails, and the hold shows each reply.
- The session state lock in `src/cli/session-state.ts`.

## Model map

Each action in `ReplyHold.tla` is one indivisible step in the code at the sync commit.

| Action | Code |
| --- | --- |
| `UserPrompts` | Claude Code starts a turn with a new turn ID. |
| `StepStarts` | `hooks/reply-hold.ts:180-183`: reset `turn` for a new turn ID, clear `lastStepHeld`, and compare `blocks` with `BLOCK_LIMIT`. The model picks the reply that the model writes. |
| `PassesOn` | `hooks/reply-hold.ts:183`: `return yield* next(e)` after two blocks. |
| `ReadsStep` | `hooks/reply-hold.ts:185-190`: `readAll`, and a step with no text shows unchanged. |
| `CheckPasses` | `hooks/reply-hold.ts:194` and `201-204`: the check gives no feedback, and the pieces show. |
| `CheckHolds` | `hooks/reply-hold.ts:206-208`: push the held reply, set `lastStepHeld`, and show the notice. |
| `CheckFails` | `hooks/reply-hold.ts:195-204`: the check throws, the hook logs a warning, and the pieces show. A hook error that `restoreReply` (`hooks/reply-hold.ts:212-228`) handles has the same result. |
| `UserInterrupts` | `hooks/reply-hold.ts:186`, `196`, and `200`: after an abort, the hook returns and shows nothing. |
| `HookBlocksStop` | `hooks/reply-hold.ts:235-239`: `blockHeldReply` blocks when the last step was held, and it counts the block. |
| `CommandHookBlocksStop` | `hooks/reply-hold.ts:236` calls the `Stop` command hook of `hooks/hooks.json`. `src/cli/hook.ts:537-546` blocks a reply with hard violations when `stop_hook_active` is false. |
| `TurnEnds` | The two `Stop` hooks allow the stop. |
| `AllTurnsDone` | The model has no more turns. |

## Read a result

- Read each TLC result with the `/statechart` skill.
  For a property that breaks, it gives the shortest path in plain words.
- Replay each path against the real code, one step for each action.
  `test/extension/reply-hold.test.ts` drives `holdReply` and `blockHeldReply` with a stub host.
  `test/cli/hook.test.ts` drives the `Stop` command hook through the CLI.
- If a step of the path cannot occur in the code, the model is wrong. Correct the model, and say what was wrong.
- If each step can occur, it is a bug in the code. Report the path in the words of the code, and do not weaken the property.

## Update the verification for an intended change

1. Read the diff of each covered file, and decide if the change alters what the model describes.
2. Change `ReplyHold.tla` and the model map from the code, before you run the check. Keep one indivisible code step as one action.
3. Change a property only when the promise changed on purpose. Cite the evidence, such as an ADR, a test, or a commit message.
4. Run `bun run verify`, and read each failure as "Read a result" tells you.
5. Copy each new SHA-256 that the check prints into `record.json`.
6. When the model no longer contains the find text of a break, write a new break for the same guard.
7. When a finding no longer breaks, set its status to `holds` and record a break for it.
8. Run `bun run verify` again until it passes.

When the writing-rule hook of this plugin blocks an edit of `ReplyHold.tla` as prose, write the file with a shell command.
`src/engine/kinds.ts` does not classify TLA+ files.

## Sync commit

`syncCommit` in `record.json` is the main commit at which a person last confirmed that the model describes the covered code.
This repository squash-merges each PR, so a commit of a PR branch is not on main after the merge.
On a PR branch, keep `syncCommit` at a main commit.
The SHA-256 digests in `record.json` name the exact content that the model describes.
To find the newest main commit that the record describes, find the newest main commit where each covered file has its recorded digest.
Move `syncCommit` only after you confirm that the model describes the code at the new commit.

## State chart part of each PR

Each PR needs a State chart part: a heading "State chart", then a Mermaid chart or the words "No state change".
Put it in the PR text or in one PR comment.
The no-mistakes pipeline writes the full PR text again on each later run, so prefer one PR comment.

The chart shows only the behavior that the PR changes, and the states around it that a reader needs to follow the change.
It does not show the full application.
Write the TLA+ model of the chart in a scratch folder outside the repository, and draw it with the `/statechart` skill.
When the PR changes the reply hold, you can start from a copy of `ReplyHold.tla` with smaller bounds.
When the PR changes no behavior that moves between states, write "No state change" and one sentence that says why.

The `verify` job reads the PR text and comments when the PR opens, when the PR text changes, and on each push.
A new comment does not start the job.
After you post the comment, run the failed `verify` job again.

For drift that builds up across many commits, use the `/maintain-formal-verification-skill` skill.
