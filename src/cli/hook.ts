import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Cause, Effect } from "effect"
import { blankCommitMetadata, findCommitInvocations } from "../adapter/commit-message.ts"
import { formatViolations } from "../adapter/feedback.ts"
import { loadConfig } from "../config/load.ts"
import { loadDictionary } from "../dictionary/load.ts"
import { classifyPath } from "../engine/kinds.ts"
import { lint } from "../engine/lint.ts"
import type { Tagger } from "../engine/tagger.ts"
import type { LintOptions, Violation } from "../engine/types.ts"
import { TaggerService } from "../tagger/wink.ts"

interface WriteEvent {
  readonly cwd: string
  readonly toolName: "Write"
  readonly filePath: string
  readonly content: string
}

interface EditEvent {
  readonly cwd: string
  readonly toolName: "Edit"
  readonly filePath: string
  readonly oldString: string
  readonly newString: string
  readonly replaceAll: boolean
}

interface BashEvent {
  readonly cwd: string
  readonly toolName: "Bash"
  readonly command: string
}

type HookEvent = WriteEvent | EditEvent | BashEvent

interface HookSpecificOutput {
  readonly hookEventName: "PreToolUse"
  readonly permissionDecision: "allow" | "deny"
  readonly permissionDecisionReason?: string
  readonly additionalContext?: string
}

interface HookDecision {
  readonly hookSpecificOutput: HookSpecificOutput
}

interface HookError {
  readonly continue: true
  readonly systemMessage: string
}

export type HookOutput = HookDecision | HookError

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
  if (stringField(event, "hook_event_name") !== "PreToolUse") {
    throw new Error("hook_event_name must be PreToolUse")
  }
  const cwd = stringField(event, "cwd")
  const toolName = stringField(event, "tool_name")
  const input = record(event.tool_input, "tool_input")

  if (toolName === "Write") {
    return {
      cwd,
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
      cwd,
      toolName,
      filePath: stringField(input, "file_path"),
      oldString: stringField(input, "old_string"),
      newString: stringField(input, "new_string"),
      replaceAll: replaceAll ?? false,
    }
  }
  if (toolName === "Bash") {
    return { cwd, toolName, command: stringField(input, "command") }
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

const loadLintOptions = (cwd: string, tagger: Tagger) =>
  Effect.all({
    config: loadConfig(undefined, cwd),
    dictionary: loadDictionary(process.env.SIMPLE_ENGLISH_DICTIONARY),
  }).pipe(Effect.map(({ config, dictionary }): LintOptions => ({ ...config, dictionary, tagger })))

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

function evaluateEvent(event: HookEvent, tagger: Tagger): Effect.Effect<HookDecision, Error> {
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
      onSuccess: (event) =>
        Effect.gen(function* () {
          const tagger = yield* TaggerService
          return yield* evaluateEvent(event, tagger)
        }).pipe(
          Effect.catchAll((error) => Effect.succeed(nonBlockingWarning(error.message))),
          Effect.catchAllCause((cause) => Effect.succeed(hookInternalFailure(cause))),
        ),
    }),
  )
}
