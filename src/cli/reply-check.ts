import { Effect } from "effect"
import { formatViolations, splitViolations } from "../adapter/feedback.ts"
import { lint } from "../engine/lint.ts"
import type { Tagger } from "../engine/tagger.ts"
import { loadLintOptions, record, stringField } from "./hook.ts"
import { appendObservation } from "./observation-log.ts"

export interface ReplyCheck {
  readonly feedback?: string
}

export function runReplyCheck(raw: string, tagger: Tagger): Effect.Effect<ReplyCheck, Error> {
  return Effect.gen(function* () {
    const { sessionId, cwd, text } = yield* Effect.try({
      try: () => {
        const request = record(JSON.parse(raw) as unknown, "request")
        return {
          sessionId: stringField(request, "session_id"),
          cwd: stringField(request, "cwd"),
          text: stringField(request, "text"),
        }
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    const violations = lint("prose-file", text, yield* loadLintOptions(cwd, tagger)).violations
    const { hard } = splitViolations(violations)
    if (hard.length === 0) return {}
    yield* Effect.tryPromise(() =>
      appendObservation({
        event: "reply",
        kind: "prose-file",
        decision: "deny",
        sessionId,
        cwd,
        text,
        violations,
      }),
    ).pipe(Effect.catch(() => Effect.void))
    return {
      feedback: formatViolations("assistant reply", "Writing rules blocked reply for", hard),
    }
  })
}
