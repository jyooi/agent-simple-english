---- MODULE ReplyHold ----
EXTENDS Naturals

CONSTANTS BlockLimit, MaxTurns, MaxToolSteps

VARIABLES phase, turnId, hold, reply, shown, stopBlocks, stopActive, toolSteps

vars == <<phase, turnId, hold, reply, shown, stopBlocks, stopActive, toolSteps>>

Texts == {"none", "clean", "dirty"}

Phases == {"idle", "step", "passing", "reading", "checking", "stop", "done"}

NothingShown == [text |-> "none", check |-> "none", stopBlocks |-> 0]

Init ==
  /\ phase = "idle"
  /\ turnId = 0
  /\ hold = [id |-> 0, blocks |-> 0, noticeIsLast |-> FALSE, uncheckedIsLast |-> FALSE]
  /\ reply = [text |-> "none", tool |-> FALSE]
  /\ shown = NothingShown
  /\ stopBlocks = 0
  /\ stopActive = FALSE
  /\ toolSteps = 0

AfterStep == IF reply.tool THEN "step" ELSE "stop"

NextToolSteps == IF reply.tool THEN toolSteps + 1 ELSE toolSteps

Show(check) ==
  shown' = IF reply.text = "none"
             THEN shown
             ELSE [text |-> reply.text, check |-> check, stopBlocks |-> stopBlocks]

UserPrompts ==
  /\ phase \in {"idle", "done"}
  /\ turnId < MaxTurns
  /\ turnId' = turnId + 1
  /\ phase' = "step"
  /\ shown' = NothingShown
  /\ stopBlocks' = 0
  /\ stopActive' = FALSE
  /\ toolSteps' = 0
  /\ UNCHANGED <<hold, reply>>

StepStarts ==
  /\ phase = "step"
  /\ \E text \in Texts, tool \in BOOLEAN :
       /\ tool => toolSteps < MaxToolSteps
       /\ reply' = [text |-> text, tool |-> tool]
  /\ LET current == IF hold.id = turnId
                      THEN hold
                      ELSE [id |-> turnId, blocks |-> 0, noticeIsLast |-> FALSE, uncheckedIsLast |-> FALSE]
     IN /\ hold' = IF current.blocks >= BlockLimit
                      THEN [current EXCEPT !.noticeIsLast = FALSE, !.uncheckedIsLast = TRUE]
                      ELSE current
        /\ phase' = IF current.blocks >= BlockLimit THEN "passing" ELSE "reading"
  /\ UNCHANGED <<turnId, shown, stopBlocks, stopActive, toolSteps>>

PassesOn ==
  /\ phase = "passing"
  /\ Show("none")
  /\ phase' = AfterStep
  /\ toolSteps' = NextToolSteps
  /\ UNCHANGED <<turnId, hold, reply, stopBlocks, stopActive>>

ReadsStep ==
  /\ phase = "reading"
  /\ hold' = IF reply.text = "none" THEN hold ELSE [hold EXCEPT !.noticeIsLast = FALSE, !.uncheckedIsLast = FALSE]
  /\ phase' = IF reply.text = "none" THEN AfterStep ELSE "checking"
  /\ toolSteps' = IF reply.text = "none" THEN NextToolSteps ELSE toolSteps
  /\ UNCHANGED <<turnId, reply, shown, stopBlocks, stopActive>>

CheckPasses ==
  /\ phase = "checking"
  /\ reply.text = "clean"
  /\ Show("clean")
  /\ phase' = AfterStep
  /\ toolSteps' = NextToolSteps
  /\ UNCHANGED <<turnId, hold, reply, stopBlocks, stopActive>>

CheckHolds ==
  /\ phase = "checking"
  /\ reply.text = "dirty"
  /\ hold' = [hold EXCEPT !.noticeIsLast = TRUE]
  /\ shown' = [text |-> "notice", check |-> "dirty", stopBlocks |-> stopBlocks]
  /\ phase' = AfterStep
  /\ toolSteps' = NextToolSteps
  /\ UNCHANGED <<turnId, reply, stopBlocks, stopActive>>

CheckFails ==
  /\ phase = "checking"
  /\ hold' = [hold EXCEPT !.uncheckedIsLast = TRUE]
  /\ Show("error")
  /\ phase' = AfterStep
  /\ toolSteps' = NextToolSteps
  /\ UNCHANGED <<turnId, reply, stopBlocks, stopActive>>

UserInterrupts ==
  /\ phase \in {"reading", "checking"}
  /\ phase' = "idle"
  /\ UNCHANGED <<turnId, hold, reply, shown, stopBlocks, stopActive, toolSteps>>

HookBlocksStop ==
  /\ phase = "stop"
  /\ hold.noticeIsLast
  /\ hold.blocks < BlockLimit
  /\ hold' = [hold EXCEPT !.blocks = @ + 1]
  /\ stopBlocks' = stopBlocks + 1
  /\ stopActive' = TRUE
  /\ phase' = "step"
  /\ UNCHANGED <<turnId, reply, shown, toolSteps>>

CommandHookBlocksStop ==
  /\ phase = "stop"
  /\ ~(hold.noticeIsLast /\ hold.blocks < BlockLimit)
  /\ ~stopActive
  /\ reply.text = "dirty"
  /\ hold' = IF hold.uncheckedIsLast THEN [hold EXCEPT !.blocks = @ + 1] ELSE hold
  /\ stopBlocks' = stopBlocks + 1
  /\ stopActive' = TRUE
  /\ phase' = "step"
  /\ UNCHANGED <<turnId, reply, shown, toolSteps>>

TurnEnds ==
  /\ phase = "stop"
  /\ ~(hold.noticeIsLast /\ hold.blocks < BlockLimit)
  /\ stopActive \/ reply.text # "dirty"
  /\ phase' = "done"
  /\ UNCHANGED <<turnId, hold, reply, shown, stopBlocks, stopActive, toolSteps>>

AllTurnsDone ==
  /\ turnId = MaxTurns
  /\ phase \in {"idle", "done"}
  /\ UNCHANGED vars

Next ==
  \/ UserPrompts
  \/ StepStarts
  \/ PassesOn
  \/ ReadsStep
  \/ CheckPasses
  \/ CheckHolds
  \/ CheckFails
  \/ UserInterrupts
  \/ HookBlocksStop
  \/ CommandHookBlocksStop
  \/ TurnEnds
  \/ AllTurnsDone

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ phase \in Phases
  /\ turnId \in 0..MaxTurns
  /\ hold.blocks \in 0..BlockLimit + 1
  /\ hold.noticeIsLast \in BOOLEAN
  /\ hold.uncheckedIsLast \in BOOLEAN
  /\ reply.text \in Texts
  /\ shown.text \in Texts \cup {"notice"}
  /\ toolSteps \in 0..MaxToolSteps

HeldTextStaysHidden ==
  shown.text = "dirty" => shown.check = "error" \/ shown.stopBlocks >= BlockLimit

NoticeIsFollowed == phase = "done" => shown.text # "notice" \/ stopBlocks >= BlockLimit

RewritesBounded == stopBlocks <= BlockLimit

RewritesFinite == stopBlocks <= BlockLimit + 1

StateBound == stopBlocks <= BlockLimit + 1
====
