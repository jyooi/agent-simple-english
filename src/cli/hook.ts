import { open, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Cause, Effect } from "effect"
import { blankCommitMetadata, findCommitInvocations } from "../adapter/commit-message.ts"
import { formatViolations } from "../adapter/feedback.ts"
import { ruleSummary } from "../adapter/rule-summary.ts"
import { loadConfig } from "../config/load.ts"
import { loadDictionary } from "../dictionary/load.ts"
import { classifyPath } from "../engine/kinds.ts"
import { lint } from "../engine/lint.ts"
import type { Tagger } from "../engine/tagger.ts"
import type { LintOptions, Violation } from "../engine/types.ts"
import { TaggerService } from "../tagger/wink.ts"
import { consumePendingFeedback, setPendingFeedback } from "./session-state.ts"

interface CommonEvent {
  readonly cwd: string
  readonly sessionId: string
  readonly transcriptPath: string
}

interface SessionStartEvent extends CommonEvent {
  readonly hookEventName: "SessionStart"
}

interface WriteEvent extends CommonEvent {
  readonly hookEventName: "PreToolUse"
  readonly toolName: "Write"
  readonly filePath: string
  readonly content: string
}

interface EditEvent extends CommonEvent {
  readonly hookEventName: "PreToolUse"
  readonly toolName: "Edit"
  readonly filePath: string
  readonly oldString: string
  readonly newString: string
  readonly replaceAll: boolean
}

interface BashEvent extends CommonEvent {
  readonly hookEventName: "PreToolUse"
  readonly toolName: "Bash"
  readonly command: string
}

interface StopEvent extends CommonEvent {
  readonly hookEventName: "Stop"
}

interface UserPromptSubmitEvent extends CommonEvent {
  readonly hookEventName: "UserPromptSubmit"
}

type PreToolUseEvent = WriteEvent | EditEvent | BashEvent
type HookEvent = SessionStartEvent | PreToolUseEvent | StopEvent | UserPromptSubmitEvent

interface HookSpecificOutput {
  readonly hookEventName: "PreToolUse"
  readonly permissionDecision: "allow" | "deny"
  readonly permissionDecisionReason?: string
  readonly additionalContext?: string
}

interface HookDecision {
  readonly hookSpecificOutput: HookSpecificOutput
}

interface ContextOutput {
  readonly hookSpecificOutput: {
    readonly hookEventName: "SessionStart" | "UserPromptSubmit"
    readonly additionalContext: string
  }
}

interface HookError {
  readonly continue: true
  readonly systemMessage: string
}

export type HookOutput = HookDecision | ContextOutput | HookError | Record<string, never>

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function stringField(value: Record<string, unknown>, name: string): string {
  const field = value[name]
  if (typeof field !== "string") throw new Error(`${name} must be a string`)
  return field
}

function decodeEvent(raw: string): HookEvent {
  const event = record(JSON.parse(raw) as unknown, "event")
  const hookEventName = stringField(event, "hook_event_name")
  const common = {
    cwd: stringField(event, "cwd"),
    sessionId: stringField(event, "session_id"),
    transcriptPath: stringField(event, "transcript_path"),
  }
  if (hookEventName === "SessionStart") return { ...common, hookEventName }
  if (hookEventName === "Stop") return { ...common, hookEventName }
  if (hookEventName === "UserPromptSubmit") return { ...common, hookEventName }
  if (hookEventName !== "PreToolUse") {
    throw new Error("hook_event_name must be SessionStart, PreToolUse, Stop, or UserPromptSubmit")
  }
  const toolName = stringField(event, "tool_name")
  const input = record(event.tool_input, "tool_input")

  if (toolName === "Write") {
    return {
      ...common,
      hookEventName,
      toolName,
      filePath: stringField(input, "file_path"),
      content: stringField(input, "content"),
    }
  }
  if (toolName === "Edit") {
    const replaceAll = input.replace_all
    if (replaceAll !== undefined && typeof replaceAll !== "boolean") {
      throw new Error("replace_all must be a boolean")
    }
    return {
      ...common,
      hookEventName,
      toolName,
      filePath: stringField(input, "file_path"),
      oldString: stringField(input, "old_string"),
      newString: stringField(input, "new_string"),
      replaceAll: replaceAll ?? false,
    }
  }
  if (toolName === "Bash") {
    return { ...common, hookEventName, toolName, command: stringField(input, "command") }
  }
  throw new Error(`unsupported PreToolUse tool: ${toolName}`)
}

function allow(warnings: string[] = []): HookDecision {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      ...(warnings.length === 0 ? {} : { additionalContext: warnings.join("\n\n") }),
    },
  }
}

function deny(reason: string): HookDecision {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }
}

function addContext(
  hookEventName: "SessionStart" | "UserPromptSubmit",
  context: string,
): ContextOutput {
  return {
    hookSpecificOutput: {
      hookEventName,
      additionalContext: context,
    },
  }
}

function nonBlockingError(message: string): HookError {
  return {
    continue: true,
    systemMessage: `STE hook error: ${message}. The event is allowed.`,
  }
}

function nonBlockingWarning(message: string): HookDecision {
  return allow([`STE hook warning: ${message}. The event is allowed.`])
}

export function hookInternalFailure(cause: Cause.Cause<unknown>): HookOutput {
  return nonBlockingWarning(`internal failure: ${Cause.pretty(cause)}`)
}

function proposedEdit(
  previousText: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  if (oldString.length === 0) throw new Error("old_string must not be empty")
  const firstMatch = previousText.indexOf(oldString)
  if (firstMatch === -1) throw new Error("old_string was not found in the edit file")
  if (replaceAll) return previousText.replaceAll(oldString, () => newString)
  if (previousText.indexOf(oldString, firstMatch + oldString.length) !== -1) {
    throw new Error("old_string is not unique in the edit file")
  }
  return `${previousText.slice(0, firstMatch)}${newString}${previousText.slice(firstMatch + oldString.length)}`
}

const readEditFile = (path: string) =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => new Error(`cannot read edit file ${path}: ${cause}`),
  })

function assistantReply(line: string, path: string): string | undefined {
  let value: unknown
  try {
    value = JSON.parse(line) as unknown
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const entry = value as Record<string, unknown>
  if (entry.type !== "assistant") return undefined
  const message = record(entry.message, "assistant transcript message")
  const content = message.content
  if (!Array.isArray(content)) {
    throw new Error(`assistant transcript message in ${path} must contain content blocks`)
  }
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
}

function assistantReplyFromChunks(chunks: readonly Buffer[], path: string): string | undefined {
  const first = chunks[0]
  const line =
    first === undefined
      ? ""
      : chunks.length === 1
        ? first.toString("utf8")
        : Buffer.concat(chunks).toString("utf8")
  return assistantReply(line, path)
}

const TRANSCRIPT_CHUNK_SIZE = 64 * 1024

async function assistantReplyFromTranscript(path: string): Promise<string> {
  const file = await open(path, "r")
  try {
    const { size } = await file.stat()
    let position = size
    let pendingLine: Buffer[] = []

    while (position > 0) {
      const length = Math.min(TRANSCRIPT_CHUNK_SIZE, position)
      position -= length
      const chunk = Buffer.allocUnsafe(length)
      let offset = 0
      while (offset < length) {
        const { bytesRead } = await file.read(chunk, offset, length - offset, position + offset)
        if (bytesRead === 0) throw new Error(`transcript changed while reading ${path}`)
        offset += bytesRead
      }

      let lineEnd = chunk.length
      for (;;) {
        const newline = chunk.lastIndexOf(10, lineEnd - 1)
        if (newline === -1) break
        const lineHead = chunk.subarray(newline + 1, lineEnd)
        const lineChunks = lineHead.length === 0 ? pendingLine : [lineHead, ...pendingLine]
        const reply = assistantReplyFromChunks(lineChunks, path)
        if (reply !== undefined) return reply
        pendingLine = []
        lineEnd = newline
      }

      if (lineEnd > 0) pendingLine = [chunk.subarray(0, lineEnd), ...pendingLine]
      if (position === 0) {
        const reply = assistantReplyFromChunks(pendingLine, path)
        if (reply !== undefined) return reply
      }
    }
    throw new Error(`cannot find an assistant reply in ${path}`)
  } finally {
    await file.close()
  }
}

const readAssistantReply = (path: string) =>
  Effect.tryPromise({
    try: () => assistantReplyFromTranscript(path),
    catch: (cause) => new Error(`cannot read assistant reply from ${path}: ${cause}`),
  })

const updatePendingFeedback = (sessionId: string, feedback: string | undefined) =>
  Effect.tryPromise({
    try: () => setPendingFeedback(sessionId, feedback),
    catch: (cause) => new Error(`cannot update session state: ${cause}`),
  })

const takePendingFeedback = (sessionId: string) =>
  Effect.tryPromise({
    try: () => consumePendingFeedback(sessionId),
    catch: (cause) => new Error(`cannot read session state: ${cause}`),
  })

const loadLintOptions = (cwd: string, tagger: Tagger) => {
  const dictionaryPath = process.env.SIMPLE_ENGLISH_DICTIONARY
  return Effect.all({
    config: loadConfig(undefined, cwd),
    dictionary: loadDictionary(
      dictionaryPath === undefined ? undefined : resolve(cwd, dictionaryPath),
    ),
  }).pipe(Effect.map(({ config, dictionary }): LintOptions => ({ ...config, dictionary, tagger })))
}

function splitViolations(violations: readonly Violation[]): {
  readonly hard: Violation[]
  readonly soft: Violation[]
} {
  return {
    hard: violations.filter((violation) => violation.severity === "hard"),
    soft: violations.filter((violation) => violation.severity === "soft"),
  }
}

function textDecision(
  operation: "write" | "edit",
  path: string,
  text: string,
  options: LintOptions,
  previousText?: string,
): HookDecision {
  const classification = classifyPath(path)
  const report = lint(classification.kind, text, {
    ...options,
    sourceDialect: classification.sourceDialect,
    previousText,
  })
  const { hard, soft } = splitViolations(report.violations)
  if (hard.length > 0) {
    return deny(formatViolations(path, `STE blocked ${operation} for`, hard))
  }
  return allow(soft.length === 0 ? [] : [formatViolations(path, "STE warnings for", soft)])
}

function recordReplyFeedback(
  event: StopEvent,
  tagger: Tagger,
): Effect.Effect<Record<string, never>, Error> {
  return Effect.gen(function* () {
    const options = yield* loadLintOptions(event.cwd, tagger)
    const reply = yield* readAssistantReply(event.transcriptPath)
    const hard = lint("prose-file", reply, options).violations.filter(
      (violation) => violation.severity === "hard",
    )
    const feedback =
      hard.length === 0
        ? undefined
        : formatViolations("assistant reply", "STE reply feedback for", hard)
    yield* updatePendingFeedback(event.sessionId, feedback)
    return {}
  })
}

function evaluateEvent(event: PreToolUseEvent, tagger: Tagger): Effect.Effect<HookDecision, Error> {
  if (event.toolName === "Bash") {
    const invocations = findCommitInvocations(event.command)
    if (invocations.length === 0) return Effect.succeed(allow())
    if (invocations.some((invocation) => invocation.requiresExplicitMessage)) {
      return Effect.succeed(
        deny(
          "STE could not check the git commit message. Use git commit with a static -m or --message argument.",
        ),
      )
    }
    return Effect.gen(function* () {
      const options = yield* loadLintOptions(event.cwd, tagger)
      const violations = invocations.flatMap((invocation) =>
        invocation.requiresExplicitMessage
          ? []
          : lint("commit-message", blankCommitMetadata(invocation.message), options).violations,
      )
      const { hard, soft } = splitViolations(violations)
      if (hard.length > 0) {
        return deny(formatViolations("commit message", "STE blocked commit for", hard))
      }
      return allow(
        soft.length === 0 ? [] : [formatViolations("commit message", "STE warnings for", soft)],
      )
    })
  }

  return Effect.gen(function* () {
    const options = yield* loadLintOptions(event.cwd, tagger)
    const path = resolve(event.cwd, event.filePath)
    if (event.toolName === "Write") {
      return textDecision("write", path, event.content, options)
    }
    const previousText = yield* readEditFile(path)
    const text = proposedEdit(previousText, event.oldString, event.newString, event.replaceAll)
    return textDecision("edit", path, text, options, previousText)
  })
}

export function runHookMode(raw: string): Effect.Effect<HookOutput, never, TaggerService> {
  return Effect.try({
    try: () => decodeEvent(raw),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) => Effect.succeed(nonBlockingError(error.message)),
      onSuccess: (event) => {
        if (event.hookEventName === "SessionStart") {
          return loadConfig(undefined, event.cwd).pipe(
            Effect.match({
              onFailure: (error) => nonBlockingError(error.message),
              onSuccess: (config) => addContext("SessionStart", ruleSummary(config)),
            }),
          )
        }
        if (event.hookEventName === "UserPromptSubmit") {
          return takePendingFeedback(event.sessionId).pipe(
            Effect.match({
              onFailure: (error) => nonBlockingError(error.message),
              onSuccess: (feedback) =>
                feedback === undefined ? {} : addContext("UserPromptSubmit", feedback),
            }),
          )
        }
        if (event.hookEventName === "Stop") {
          return Effect.gen(function* () {
            const tagger = yield* TaggerService
            return yield* recordReplyFeedback(event, tagger)
          }).pipe(
            Effect.catchAll((error) => Effect.succeed(nonBlockingError(error.message))),
            Effect.catchAllCause((cause) =>
              Effect.succeed(nonBlockingError(`internal failure: ${Cause.pretty(cause)}`)),
            ),
          )
        }
        return Effect.gen(function* () {
          const tagger = yield* TaggerService
          return yield* evaluateEvent(event, tagger)
        }).pipe(
          Effect.catchAll((error) => Effect.succeed(nonBlockingWarning(error.message))),
          Effect.catchAllCause((cause) => Effect.succeed(hookInternalFailure(cause))),
        )
      },
    }),
  )
}
