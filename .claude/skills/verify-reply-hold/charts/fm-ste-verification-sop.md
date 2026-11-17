## State chart

This chart shows the behavior that this PR adds a check for: one strict-mode turn of the reply hold, from `hooks/reply-hold.ts` and the `Stop` command hook.
TLC drew it from a scratch copy of `ReplyHold.tla` with one turn and one tool step (426 states).

```mermaid
---
title: "Strict reply hold in one turn"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: waiting
    lg1: writing
    lg2: stopping
    lg3: over
    lg4: Breaks NoticeIsFollowed or RewritesBounded
    lg5: Breaks RewritesBounded in some cases
    lg6: Path to the NoticeIsFollowed or RewritesBounded bug
  }
  class lg0 tan
  class lg1 blue
  class lg2 yellow
  class lg3 teal
  class lg4 breaks
  class lg5 mayBreak
  class lg6 bugPath
  s0: Waiting for your prompt
  s1: The model writes
  s2: The check reads the step
  s3: Interrupted
  s4: Stop, a reply or no text is last
  s5: Turn over, a reply or no text is last
  s6: The model writes, the notice shows
  s7: Stop, last step held
  s8: Stop, the notice is the last text
  s9: Turn over, the notice is the last text
  s10: A step shows with no check
  [*] --> s0
  s0 --> s1: you send a prompt
  s1 --> s1: the model writes
  s1 --> s2: the step has text
  s1 --> s3: you interrupt
  s1 --> s4: the step has no text
  s2 --> s4: the check passes or the check fails
  s2 --> s1: the check passes, and a tool runs or the check fails, and a tool runs
  s2 --> s7: the check finds a violation
  s2 --> s6: the check finds a violation, and a tool runs
  s4 --> s5: the turn ends
  s6 --> s6: the model writes
  s4 --> s1: the Stop command hook blocks
  s7 --> s6: the hold blocks the stop
  s6 --> s2: the step has text
  s6 --> s8: the step has no text
  s8 --> s9: the turn ends
  s6 --> s10: the model writes [after two rewrites]
  s10 --> s4: the step shows
  s10 --> s1: the step shows, and a tool runs
  s10 --> s8: the step shows
  s10 --> s6: the step shows, and a tool runs
  s1 --> s10: the model writes [after two rewrites]
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  class s0 tan
  class s0 bugPath
  class s1 blue
  class s1 mayBreak
  class s1 bugPath
  class s2 blue
  class s2 bugPath
  class s3 tan
  class s4 yellow
  class s4 mayBreak
  class s4 bugPath
  class s5 teal
  class s5 mayBreak
  class s6 blue
  class s6 mayBreak
  class s6 bugPath
  class s7 yellow
  class s7 bugPath
  class s8 yellow
  class s8 mayBreak
  class s8 bugPath
  class s9 teal
  class s9 breaks
  class s9 bugPath
  class s10 blue
  class s10 mayBreak
```

Bugs that the chart marks:

- `NoticeIsFollowed` breaks: "When a turn ends, the last text on the screen is not the hold notice." Path: you send a prompt, the check finds a violation and a tool runs, the model ends the turn with no text, the turn ends.
- `RewritesBounded` breaks: "A turn has two Stop blocks or fewer, as ADR 0005 states." Path: the check fails, the Stop command hook blocks, the hold blocks two times.

The chart shows "you interrupt" only from "The model writes". It does not draw steps that stay in one chart state.

Covered digest: `ca49447b0b4b36e310ff015dc617a189b35a79cbc83e927d6011bc5900c61079`
