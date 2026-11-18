## State chart

This chart shows the stop and rewrite paths of the strict reply hold that this PR corrects.
TLC drew it from a scratch copy of `ReplyHold.tla` with one turn and one tool step (267 states).
No rule breaks in this chart.

![State chart of the stop and rewrite paths of the strict reply hold](fm-ste-reply-hold-fixes.svg)

```mermaid
---
title: "Strict reply hold: block and rewrite paths in one turn"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: waiting
    lg1: writing
    lg2: stopping
    lg3: over
  }
  class lg0 tan
  class lg1 blue
  class lg2 yellow
  class lg3 teal
  s0: Waiting for your prompt
  s1: The model writes
  s2: The check reads the step
  s3: Interrupted
  s4: Stop, a reply or no text is last
  s5: Turn over, a reply or no text is last
  s6: The model writes, the notice is last
  s7: Stop, the notice is last, fewer than two blocks
  s8: The model writes, two blocks used, no check
  s9: Stop, the notice is last, two blocks used
  s10: Turn over, the notice is last, two blocks used
  [*] --> s0
  s0 --> s1: you send a prompt
  s1 --> s2: the step has text
  s1 --> s3: you interrupt
  s1 --> s4: the step has no text
  s2 --> s4: the check passes or the check fails
  s2 --> s1: the check passes, and a tool runs or the check fails, and a tool runs
  s2 --> s7: the check finds a violation
  s2 --> s6: the check finds a violation, and a tool runs
  s4 --> s5: the turn ends
  s4 --> s1: the Stop command hook blocks, and the hold counts the block
  s7 --> s6: the hold blocks the stop
  s6 --> s2: the step has text
  s6 --> s7: the step has no text
  s6 --> s8: the model writes [after two blocks]
  s8 --> s4: the step shows
  s8 --> s1: the step shows, and a tool runs
  s8 --> s9: the step shows
  s8 --> s6: the step shows, and a tool runs
  s1 --> s8: the model writes [after two blocks]
  s9 --> s10: the turn ends
  class s0 tan
  class s1 blue
  class s2 blue
  class s3 tan
  class s4 yellow
  class s5 teal
  class s6 blue
  class s7 yellow
  class s8 blue
  class s9 yellow
  class s10 teal
```

What the PR changes in the chart:

- A step with no text after the notice leads to "Stop, the notice is last, fewer than two blocks".
  The hold blocks there. Before the PR, the turn ended there, and the notice stayed.
- "the hold blocks the stop" leads back to "The model writes, the notice is last".
  The notice stays the last text until a step shows text, so a rewrite with no text leads to a second block.
- "the Stop command hook blocks, and the hold counts the block" uses one of the two blocks.
  Before the PR, the hold still allowed two more blocks, so a turn had three.
- "Turn over, the notice is last, two blocks used" stays reachable.
  After two blocks, the hold shows the next step as written, also when it has no text.

The chart shows "you interrupt" only from "The model writes".
It does not draw steps that stay in one chart state.

Covered digest: `634ae73ccbc7bd281bb8b509d3ae6fc5b6962548ba23e7621fa635d6c7bc3539`
