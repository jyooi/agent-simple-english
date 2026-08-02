import { constants } from "node:fs"
import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {
  type ExtensionAPI,
  type ExtensionContext,
  ExtensionRunner,
  type MessageStartEvent,
  type MessageUpdateEvent,
  type ToolCallEventResult,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent"
import type { AutocompleteItem } from "@earendil-works/pi-tui"
import { Effect } from "effect"
import { Type } from "typebox"
import { blankCommitMetadata, findCommitInvocations } from "../adapter/commit-message.ts"
import { formatViolations, violationDetails } from "../adapter/feedback.ts"
import { formatStatusSummary, ruleSummary } from "../adapter/rule-summary.ts"
import { loadConfig } from "../config/load.ts"
import type { SteConfig } from "../config/schema.ts"
import { loadDictionary, loadRuleData } from "../dictionary/load.ts"
import type { RuleData } from "../dictionary/rule-data.ts"
import type { Dictionary } from "../dictionary/schema.ts"
import { classifyPath } from "../engine/kinds.ts"
import { lint } from "../engine/lint.ts"
import type { Tagger } from "../engine/tagger.ts"
import type { LintReport, Violation } from "../engine/types.ts"
import { makeWinkTagger } from "../tagger/wink.ts"

const COMMAND_COMPLETIONS: readonly AutocompleteItem[] = [
  { value: "on", label: "on", description: "Enable writing-rule enforcement" },
  { value: "off", label: "off", description: "Disable writing-rule enforcement" },
  { value: "status", label: "status", description: "Show writing-rule status" },
  { value: "strict", label: "strict", description: "Enable strict reply gating" },
]

interface SessionState {
  config: SteConfig
  dictionary?: Dictionary
  ruleData?: RuleData
  tagger?: Tagger
  enabled: boolean
  error?: string
  dictionaryError?: string
  ready: boolean
  strict: boolean
  pendingReplyFeedback?: string
  readonly approvedSayReplies: Map<string, string>
  readonly pendingSayArguments: Map<string, Record<string, unknown>>
  readonly pendingWarnings: Map<string, string>
  readonly rejectedSayReplies: Map<string, string>
}

const STRICT_MODE_NOTE = [
  "## Writing rules: strict mode",
  "",
  "Send every user-facing reply through the `say` tool.",
  "Write no prose outside that tool.",
  "Call `say` as your final action.",
  "A hard violation blocks the call before the user reads the text.",
  "Read the feedback, rewrite the text, and call `say` again.",
].join("\n")

let sharedTagger: Tagger | undefined

function statusSummary(state: SessionState): string {
  const mode = !state.enabled ? "disabled" : state.strict ? "strict" : "enabled"
  const dictionary =
    state.dictionary !== undefined
      ? "loaded"
      : state.dictionaryError !== undefined
        ? `failed (${state.dictionaryError})`
        : "not loaded"
  return formatStatusSummary(state.config, mode, dictionary)
}

function formatReplyFeedback(violations: readonly Violation[]): string {
  return `Writing-rule feedback for your previous reply:\n${violationDetails(violations)}`
}

function lintReply(state: SessionState, text: string): LintReport {
  return lint("prose-file", text, {
    ...state.config,
    dictionary: state.dictionary,
    ruleData: state.ruleData,
    tagger: state.tagger,
  })
}

type AssistantMessage = Extract<MessageStartEvent["message"], { role: "assistant" }>
type Message = MessageStartEvent["message"]

type BoundaryRegistry = {
  installed: boolean
  readonly states: WeakMap<object, SessionState>
}

type BoundaryGlobal = typeof globalThis & {
  __simpleEnglishStrictBoundaryV1?: BoundaryRegistry
}

const REDACTED_SAY_TEXT = "[redacted until writing-rule approval]"
const boundaryGlobal = globalThis as BoundaryGlobal
const boundaryRegistry = boundaryGlobal.__simpleEnglishStrictBoundaryV1 ?? {
  installed: false,
  states: new WeakMap(),
}
if (boundaryGlobal.__simpleEnglishStrictBoundaryV1 === undefined) {
  boundaryGlobal.__simpleEnglishStrictBoundaryV1 = boundaryRegistry
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function replaceRecord(
  target: Record<string, unknown>,
  replacement: Record<string, unknown>,
): void {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, replacement)
}

function captureAndRedactSayArguments(
  state: SessionState,
  toolCallId: string,
  argumentsValue: unknown,
): void {
  if (!isRecord(argumentsValue)) return
  if (argumentsValue.text !== REDACTED_SAY_TEXT) {
    state.pendingSayArguments.set(toolCallId, structuredClone(argumentsValue))
  }
  replaceRecord(argumentsValue, { text: REDACTED_SAY_TEXT })
}

function contentWithoutReplyProse(
  state: SessionState,
  message: AssistantMessage,
): AssistantMessage["content"] {
  return message.content.filter((block) => {
    if (block.type === "text" || block.type === "thinking") return false
    if (block.type === "toolCall" && block.name === "say") {
      captureAndRedactSayArguments(state, block.id, block.arguments)
    }
    return true
  })
}

function suppressAssistantReply(state: SessionState, message: Message): void {
  if (message.role === "assistant") message.content = contentWithoutReplyProse(state, message)
}

function suppressAssistantReplyUpdate(state: SessionState, event: MessageUpdateEvent): void {
  suppressAssistantReply(state, event.message)
  const update = event.assistantMessageEvent
  if ("partial" in update) suppressAssistantReply(state, update.partial)
  if (
    update.type === "text_delta" ||
    update.type === "thinking_delta" ||
    update.type === "toolcall_delta"
  ) {
    update.delta = ""
  }
  if (update.type === "text_end" || update.type === "thinking_end") update.content = ""
  if (update.type === "toolcall_end" && update.toolCall.name === "say") {
    captureAndRedactSayArguments(state, update.toolCall.id, update.toolCall.arguments)
  }
  if (update.type === "done") suppressAssistantReply(state, update.message)
  if (update.type === "error") suppressAssistantReply(state, update.error)
}

function strictSayContent(state: SessionState, toolCallId: string) {
  const approved = state.approvedSayReplies.get(toolCallId)
  if (approved !== undefined) {
    return { content: [{ type: "text" as const, text: approved }], details: {}, isError: false }
  }
  const rejected = state.rejectedSayReplies.get(toolCallId)
  if (rejected !== undefined) {
    return { content: [{ type: "text" as const, text: rejected }], details: {}, isError: true }
  }
  return { content: [], details: {}, isError: true }
}

function enforceStrictMessage(state: SessionState, message: Message): void {
  if (!state.enabled || !state.strict) return
  if (message.role === "assistant") {
    suppressAssistantReply(state, message)
    return
  }
  if (message.role !== "toolResult" || message.toolName !== "say") return
  Object.assign(message, strictSayContent(state, message.toolCallId))
}

function enforceStrictEvent(state: SessionState, eventValue: unknown): void {
  if (!state.enabled || !state.strict || !isRecord(eventValue)) return
  const event = eventValue
  if (isRecord(event.message) && "role" in event.message) {
    enforceStrictMessage(state, event.message as unknown as Message)
  }
  if (event.type === "message_update")
    suppressAssistantReplyUpdate(state, event as unknown as MessageUpdateEvent)
  if (
    (event.type === "tool_execution_start" || event.type === "tool_execution_update") &&
    event.toolName === "say" &&
    typeof event.toolCallId === "string"
  ) {
    captureAndRedactSayArguments(state, event.toolCallId, event.args)
  }
  if (
    event.type === "tool_execution_end" &&
    event.toolName === "say" &&
    typeof event.toolCallId === "string" &&
    isRecord(event.result)
  ) {
    Object.assign(event.result, strictSayContent(state, event.toolCallId))
  }
  if (event.type === "turn_end" && Array.isArray(event.toolResults)) {
    for (const result of event.toolResults) {
      if (isRecord(result) && result.role === "toolResult" && result.toolName === "say") {
        enforceStrictMessage(state, result as unknown as Message)
      }
    }
  }
  if (event.type === "agent_end" && Array.isArray(event.messages)) {
    for (const message of event.messages) {
      if (isRecord(message) && "role" in message) {
        enforceStrictMessage(state, message as unknown as Message)
      }
    }
    state.approvedSayReplies.clear()
    state.pendingSayArguments.clear()
    state.rejectedSayReplies.clear()
  }
}

function installStrictOutputBoundary(): void {
  if (boundaryRegistry.installed) return
  boundaryRegistry.installed = true

  const originalEmit = ExtensionRunner.prototype.emit
  Object.defineProperty(ExtensionRunner.prototype, "emit", {
    configurable: true,
    value: async function (this: ExtensionRunner, event: Record<string, unknown>) {
      const result = await originalEmit.call(this, event as never)
      const state = boundaryRegistry.states.get(this.createContext().sessionManager as object)
      if (state !== undefined) enforceStrictEvent(state, event)
      return result
    },
    writable: true,
  })

  const originalEmitMessageEnd = ExtensionRunner.prototype.emitMessageEnd
  Object.defineProperty(ExtensionRunner.prototype, "emitMessageEnd", {
    configurable: true,
    value: async function (this: ExtensionRunner, event: { message: Message }) {
      const replacement = await originalEmitMessageEnd.call(this, event as never)
      const state = boundaryRegistry.states.get(this.createContext().sessionManager as object)
      if (state === undefined || !state.enabled || !state.strict) return replacement
      const message = (replacement ?? event.message) as Message
      enforceStrictMessage(state, message)
      return message
    },
    writable: true,
  })

  const originalEmitToolResult = ExtensionRunner.prototype.emitToolResult
  Object.defineProperty(ExtensionRunner.prototype, "emitToolResult", {
    configurable: true,
    value: async function (
      this: ExtensionRunner,
      event: Record<string, unknown> & { toolCallId: string },
    ) {
      const replacement = await originalEmitToolResult.call(this, event as never)
      const state = boundaryRegistry.states.get(this.createContext().sessionManager as object)
      if (state === undefined || !state.enabled || !state.strict || event.toolName !== "say") {
        return replacement
      }
      return strictSayContent(state, event.toolCallId)
    },
    writable: true,
  })
}

installStrictOutputBoundary()

function showReplyReport(
  state: SessionState,
  ctx: ExtensionContext,
  report: LintReport,
  queueFeedback: boolean,
): void {
  const hard = report.violations.filter((violation) => violation.severity === "hard")
  const softCount = report.summary.total - report.summary.hard
  state.pendingReplyFeedback =
    queueFeedback && hard.length > 0 ? formatReplyFeedback(hard) : undefined
  if (!ctx.hasUI) return

  const status =
    report.summary.total === 0
      ? "Writing-rule reply: clean"
      : `Writing-rule reply: ${report.summary.hard} hard, ${softCount} soft`
  ctx.ui.setWidget("simple-english-reply", [status])
}

function updateReplyState(state: SessionState, ctx: ExtensionContext, text?: string): void {
  state.pendingReplyFeedback = undefined
  if (text === undefined) {
    if (ctx.hasUI) ctx.ui.setWidget("simple-english-reply", undefined)
    return
  }
  showReplyReport(state, ctx, lintReply(state, text), true)
}

function restoreReplyState(state: SessionState, ctx: ExtensionContext): void {
  const branch = ctx.sessionManager.getBranch()
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index]
    if (entry?.type !== "message") continue
    const message = entry.message
    if (
      message.role !== "assistant" &&
      (message.role !== "toolResult" || message.toolName !== "say" || message.isError)
    ) {
      continue
    }
    const textBlocks = message.content.filter((block) => block.type === "text")
    if (textBlocks.length === 0) continue
    updateReplyState(state, ctx, textBlocks.map((block) => block.text).join("\n"))
    return
  }
  updateReplyState(state, ctx)
}

function notifyWarnings(
  ctx: ExtensionContext,
  path: string,
  violations: readonly Violation[],
): void {
  if (violations.length === 0 || !ctx.hasUI) return
  ctx.ui.notify(formatViolations(path, "Writing-rule warnings for", violations), "warning")
}

function lintProposedText(
  state: SessionState,
  ctx: ExtensionContext,
  operation: "write" | "edit",
  toolCallId: string,
  path: string,
  text: string,
  previousText?: string,
): ToolCallEventResult | undefined {
  const classification = classifyPath(path)
  const report = lint(classification.kind, text, {
    ...state.config,
    dictionary: state.dictionary,
    ruleData: state.ruleData,
    tagger: state.tagger,
    sourceDialect: classification.sourceDialect,
    previousText,
  })
  const hard = report.violations.filter((violation) => violation.severity === "hard")
  const soft = report.violations.filter((violation) => violation.severity === "soft")
  notifyWarnings(ctx, path, soft)
  if (hard.length === 0) {
    if (soft.length > 0) {
      state.pendingWarnings.set(
        toolCallId,
        formatViolations(path, "Writing-rule warnings for", soft),
      )
    }
    return undefined
  }
  return {
    block: true,
    reason: formatViolations(path, `Writing rules blocked ${operation} for`, hard),
  }
}

function lintCommitCommand(
  state: SessionState,
  ctx: ExtensionContext,
  toolCallId: string,
  command: string,
): ToolCallEventResult | undefined {
  const invocations = findCommitInvocations(command)
  if (invocations.length === 0) return undefined
  if (!state.ready) {
    return {
      block: true,
      reason: `Writing-rule check is unavailable: ${state.error ?? "session setup is not complete"}`,
    }
  }

  const warnings: string[] = []
  for (const invocation of invocations) {
    if (invocation.requiresExplicitMessage) {
      return {
        block: true,
        reason:
          "Writing rules could not check the git commit message. Use git commit with a static -m or --message argument.",
      }
    }

    const report = lint("commit-message", blankCommitMetadata(invocation.message), {
      ...state.config,
      dictionary: state.dictionary,
      ruleData: state.ruleData,
      tagger: state.tagger,
    })
    const hard = report.violations.filter((violation) => violation.severity === "hard")
    const soft = report.violations.filter((violation) => violation.severity === "soft")
    notifyWarnings(ctx, "commit message", soft)
    if (hard.length > 0) {
      return {
        block: true,
        reason: formatViolations("commit message", "Writing rules blocked commit for", hard),
      }
    }
    if (soft.length > 0) {
      warnings.push(formatViolations("commit message", "Writing-rule warnings for", soft))
    }
  }

  if (warnings.length > 0) state.pendingWarnings.set(toolCallId, warnings.join("\n\n"))
  return undefined
}

function createGatedBashTool(cwd: string, state: SessionState) {
  const definition = createBashToolDefinition(cwd)
  const execute: typeof definition.execute = async (...args) => {
    const [toolCallId, input, _signal, _onUpdate, ctx] = args
    if (state.enabled) {
      const result = lintCommitCommand(state, ctx, toolCallId, input.command)
      if (result?.block) throw new Error(result.reason)
    }
    return definition.execute(...args)
  }
  return { ...definition, execute }
}

function lintStrictReply(
  state: SessionState,
  ctx: ExtensionContext,
  text: string,
): ToolCallEventResult | undefined {
  if (!state.ready) {
    return {
      block: true,
      reason: `Writing-rule check is unavailable: ${state.error ?? "session setup is not complete"}`,
    }
  }
  const report = lintReply(state, text)
  showReplyReport(state, ctx, report, false)
  const hard = report.violations.filter((violation) => violation.severity === "hard")
  if (hard.length === 0) return undefined
  return {
    block: true,
    reason: formatViolations("reply", "Writing rules blocked", hard),
  }
}

function createGatedWriteTool(cwd: string, state: SessionState) {
  const definition = createWriteToolDefinition(cwd)
  const execute: typeof definition.execute = async (...args) => {
    const [toolCallId, input, signal, _onUpdate, ctx] = args
    const implementation = createWriteToolDefinition(cwd, {
      operations: {
        mkdir: async () => undefined,
        writeFile: async (path, content) => {
          if (state.enabled) {
            if (!state.ready) {
              throw new Error(
                `Writing-rule check is unavailable: ${state.error ?? "session setup is not complete"}`,
              )
            }
            const result = lintProposedText(state, ctx, "write", toolCallId, input.path, content)
            if (result?.block) throw new Error(result.reason)
          }
          await mkdir(dirname(path), { recursive: true })
          if (signal?.aborted) throw new Error("Operation aborted")
          await writeFile(path, content, "utf8")
        },
      },
    })
    return implementation.execute(...args)
  }
  return { ...definition, execute }
}

function createGatedEditTool(cwd: string, state: SessionState) {
  const definition = createEditToolDefinition(cwd)
  const execute: typeof definition.execute = async (...args) => {
    const [toolCallId, input, _signal, _onUpdate, ctx] = args
    let previousText: string | undefined
    const implementation = createEditToolDefinition(cwd, {
      operations: {
        access: (path) => access(path, constants.R_OK | constants.W_OK),
        readFile: async (path) => {
          const content = await readFile(path)
          previousText = content.toString("utf8")
          return content
        },
        writeFile: async (path, content) => {
          if (state.enabled) {
            if (!state.ready) {
              throw new Error(
                `Writing-rule check is unavailable: ${state.error ?? "session setup is not complete"}`,
              )
            }
            const result = lintProposedText(
              state,
              ctx,
              "edit",
              toolCallId,
              input.path,
              content,
              previousText,
            )
            if (result?.block) throw new Error(result.reason)
          }
          await writeFile(path, content, "utf8")
        },
      },
    })
    return implementation.execute(...args)
  }
  return { ...definition, execute }
}

export default function simpleEnglishExtension(pi: ExtensionAPI): void {
  const state: SessionState = {
    config: {},
    enabled: true,
    ready: false,
    strict: false,
    approvedSayReplies: new Map(),
    pendingSayArguments: new Map(),
    pendingWarnings: new Map(),
    rejectedSayReplies: new Map(),
  }

  const setSayActive = (active: boolean): void => {
    const tools = pi.getActiveTools().filter((name) => name !== "say")
    pi.setActiveTools(active ? [...tools, "say"] : tools)
  }

  pi.registerCommand("ste", {
    description: "Toggle writing-rule enforcement or show status. Use strict to gate replies.",
    getArgumentCompletions: (prefix) => {
      const completions = COMMAND_COMPLETIONS.filter((item) => item.value.startsWith(prefix))
      return completions.length > 0 ? completions : null
    },
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase()
      if (command === "status") {
        ctx.ui.notify(statusSummary(state), "info")
        return
      }
      if (command === "strict" || command === "strict on") {
        state.enabled = true
        state.strict = true
        setSayActive(true)
        ctx.ui.notify(
          "Writing-rule strict mode enabled. Send every reply through the say tool.",
          "info",
        )
        return
      }
      if (command === "strict off") {
        state.strict = false
        setSayActive(false)
        ctx.ui.notify("Writing-rule strict mode disabled.", "info")
        return
      }
      if (command !== "" && command !== "on" && command !== "off") {
        ctx.ui.notify("Usage: /ste [on|off|status|strict|strict off]", "warning")
        return
      }

      state.enabled = command === "on" || (command === "" && !state.enabled)
      if (!state.enabled) {
        state.strict = false
        setSayActive(false)
        state.pendingReplyFeedback = undefined
        state.approvedSayReplies.clear()
        state.pendingSayArguments.clear()
        state.pendingWarnings.clear()
        state.rejectedSayReplies.clear()
        if (ctx.hasUI) ctx.ui.setWidget("simple-english-reply", undefined)
      }
      ctx.ui.notify(
        `Writing-rule enforcement ${state.enabled ? "enabled" : "disabled"}.`,
        "info",
      )
    },
  })

  pi.registerTool({
    name: "say",
    label: "Say",
    description:
      "Send prose to the user. In writing-rule strict mode, use this tool for every user-facing reply.",
    parameters: Type.Object({
      text: Type.String({ description: "The complete user-facing reply" }),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      if (state.enabled && state.strict) {
        const result = lintStrictReply(state, ctx, params.text)
        if (result?.block) {
          state.approvedSayReplies.delete(toolCallId)
          state.rejectedSayReplies.set(
            toolCallId,
            result.reason ?? "Writing rules blocked the reply.",
          )
          throw new Error(result.reason)
        }
        state.approvedSayReplies.set(toolCallId, params.text)
        state.rejectedSayReplies.delete(toolCallId)
      }
      return {
        content: [{ type: "text" as const, text: params.text }],
        details: {},
        terminate: true,
      }
    },
  })

  pi.on("session_start", async (_event, ctx) => {
    boundaryRegistry.states.set(ctx.sessionManager as object, state)
    setSayActive(state.enabled && state.strict)
    state.config = {}
    state.dictionary = undefined
    state.ruleData = undefined
    state.tagger = undefined
    state.ready = false
    state.error = undefined
    state.dictionaryError = undefined
    state.approvedSayReplies.clear()
    state.pendingSayArguments.clear()
    state.pendingWarnings.clear()
    state.rejectedSayReplies.clear()
    updateReplyState(state, ctx)
    pi.registerTool(createGatedBashTool(ctx.cwd, state))
    pi.registerTool(createGatedWriteTool(ctx.cwd, state))
    pi.registerTool(createGatedEditTool(ctx.cwd, state))

    try {
      state.config = await Effect.runPromise(loadConfig(undefined, ctx.cwd, ctx.isProjectTrusted()))
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error)
      if (ctx.hasUI)
        ctx.ui.notify(`Simple English extension failed to start: ${state.error}`, "error")
      return
    }

    try {
      const loadedData = await Effect.runPromise(
        Effect.all({
          dictionary: loadDictionary(process.env.SIMPLE_ENGLISH_DICTIONARY),
          ruleData: loadRuleData(state.config.ruleDataExtensions, ctx.cwd),
        }),
      )
      state.dictionary = loadedData.dictionary
      state.ruleData = loadedData.ruleData
    } catch (error) {
      state.dictionaryError = error instanceof Error ? error.message : String(error)
      state.error = state.dictionaryError
      if (ctx.hasUI)
        ctx.ui.notify(`Simple English extension failed to start: ${state.error}`, "error")
      return
    }

    try {
      sharedTagger ??= makeWinkTagger()
      state.tagger = sharedTagger
      state.ready = true
      if (state.enabled) restoreReplyState(state, ctx)
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error)
      if (ctx.hasUI)
        ctx.ui.notify(`Simple English extension failed to start: ${state.error}`, "error")
    }
  })

  pi.on("session_shutdown", (_event, ctx) => {
    boundaryRegistry.states.delete(ctx.sessionManager as object)
  })

  pi.on("session_tree", (_event, ctx) => {
    if (state.enabled && state.ready) restoreReplyState(state, ctx)
    else updateReplyState(state, ctx)
  })

  pi.on("before_agent_start", (event) => {
    if (!state.enabled) return undefined
    const additions = [ruleSummary(state.config)]
    if (state.strict) additions.push(STRICT_MODE_NOTE)
    return { systemPrompt: `${event.systemPrompt}\n\n${additions.join("\n\n")}` }
  })

  pi.on("message_start", (event) => {
    if (state.enabled && state.strict) enforceStrictMessage(state, event.message)
  })

  pi.on("message_update", (event) => {
    if (state.enabled && state.strict) suppressAssistantReplyUpdate(state, event)
  })

  pi.on("message_end", (event) => {
    if (!state.enabled || !state.strict) return undefined
    enforceStrictMessage(state, event.message)
    return { message: event.message }
  })

  pi.on("tool_execution_start", (event) => enforceStrictEvent(state, event))
  pi.on("tool_execution_update", (event) => enforceStrictEvent(state, event))
  pi.on("tool_execution_end", (event) => enforceStrictEvent(state, event))

  pi.on("turn_end", (event, ctx) => {
    if (!state.enabled || !state.ready || event.message.role !== "assistant") return
    const textBlocks = event.message.content.filter((block) => block.type === "text")
    if (textBlocks.length === 0) return
    updateReplyState(state, ctx, textBlocks.map((block) => block.text).join("\n"))
  })

  pi.on("context", (event) => {
    if (!state.enabled) return undefined
    const feedback = state.pendingReplyFeedback
    if (feedback === undefined) return undefined
    state.pendingReplyFeedback = undefined
    return {
      messages: [
        ...event.messages,
        {
          role: "custom" as const,
          customType: "simple-english-reply-feedback",
          content: feedback,
          display: false,
          timestamp: Date.now(),
        },
      ],
    }
  })

  pi.on("tool_call", async (event, ctx) => {
    if (!state.enabled) return undefined
    if (event.toolName === "say" && state.strict) {
      const savedArguments = state.pendingSayArguments.get(event.toolCallId)
      if (savedArguments !== undefined) replaceRecord(event.input, structuredClone(savedArguments))
      const text = (event.input as { text?: unknown }).text
      if (typeof text !== "string") {
        const reason = "Writing rules could not check the reply: say requires text."
        state.rejectedSayReplies.set(event.toolCallId, reason)
        return { block: true, reason }
      }
      const result = lintStrictReply(state, ctx, text)
      if (result?.block) {
        state.rejectedSayReplies.set(
          event.toolCallId,
          result.reason ?? "Writing rules blocked the reply.",
        )
      }
      return result
    }
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined
    if (state.ready) return undefined
    return {
      block: true,
      reason: `Writing-rule check is unavailable: ${state.error ?? "session setup is not complete"}`,
    }
  })

  pi.on("tool_result", (event) => {
    const warning = state.pendingWarnings.get(event.toolCallId)
    if (warning === undefined) return undefined
    state.pendingWarnings.delete(event.toolCallId)
    return { content: [...event.content, { type: "text" as const, text: warning }] }
  })
}
