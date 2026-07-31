import { constants } from "node:fs"
import { access, readFile, writeFile } from "node:fs/promises"
import {
  createEditToolDefinition,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolCallEventResult,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent"
import { Effect } from "effect"
import { loadConfig } from "../config/load.ts"
import type { SteConfig } from "../config/schema.ts"
import { loadDictionary } from "../dictionary/load.ts"
import type { Dictionary } from "../dictionary/schema.ts"
import { classifyPath } from "../engine/kinds.ts"
import { lint } from "../engine/lint.ts"
import type { RuleId } from "../engine/rules/registry.ts"
import type { Tagger } from "../engine/tagger.ts"
import type { RuleSetting, Violation } from "../engine/types.ts"
import { makeWinkTagger } from "../tagger/wink.ts"

const DEFAULT_RULE_SETTINGS: Readonly<Record<RuleId, RuleSetting>> = {
  contraction: "hard",
  "dictionary-not-approved-word": "hard",
  hedging: "soft",
  marketing: "soft",
  "paragraph-length": "hard",
  "phrasal-verb": "hard",
  semicolon: "hard",
  "sentence-length": "hard",
  "verb-progressive": "hard",
  "verb-passive": "soft",
  "verb-perfect": "hard",
}

const RULE_SUMMARIES: Readonly<Record<RuleId, string>> = {
  contraction: "Do not use contractions. Write the words in full.",
  "dictionary-not-approved-word": "Use approved words from the STE dictionary.",
  hedging: "Remove hedging phrases.",
  marketing: "Use factual language instead of marketing language.",
  "paragraph-length": "Use no more than six sentences in one paragraph.",
  "phrasal-verb": "Use an approved single-word verb instead of a phrasal verb.",
  semicolon: "Do not use semicolons. Write two sentences.",
  "sentence-length": "Keep each sentence within the configured word limit.",
  "verb-progressive": "Do not use progressive verb forms.",
  "verb-passive": "Prefer active voice.",
  "verb-perfect": "Do not use perfect verb forms.",
}

interface SessionState {
  config: SteConfig
  dictionary?: Dictionary
  tagger?: Tagger
  error?: string
  ready: boolean
  readonly pendingWarnings: Map<string, string>
}

function resolvedSetting(config: SteConfig, ruleId: RuleId): RuleSetting {
  return config.rules?.[ruleId] ?? DEFAULT_RULE_SETTINGS[ruleId]
}

function ruleSummary(config: SteConfig): string {
  const maxSentenceWords = config.maxSentenceWords ?? 25
  const rules = (Object.keys(RULE_SUMMARIES) as RuleId[])
    .filter((ruleId) => resolvedSetting(config, ruleId) !== "off")
    .map((ruleId) => {
      const summary =
        ruleId === "sentence-length"
          ? `Keep each sentence to ${maxSentenceWords} words or fewer.`
          : RULE_SUMMARIES[ruleId]
      return `- [${resolvedSetting(config, ruleId)}] ${summary}`
    })
    .join("\n")
  return `## Simplified Technical English\n\nFollow these STE rules in prose that you write or edit:\n${rules}\n\nThe write and edit tools reject hard violations. Correct the reported text and retry. Soft violations produce warnings.`
}

function suggestedFix(violation: Violation): string {
  if (violation.suggestion !== undefined) return `Use "${violation.suggestion}".`
  if (violation.suggestions !== undefined && violation.suggestions.length > 0) {
    return `Use one of these approved alternatives: ${violation.suggestions.map((item) => `"${item}"`).join(", ")}.`
  }
  const fixes: Readonly<Record<RuleId, string>> = {
    contraction: "Write the contracted words in full.",
    "dictionary-not-approved-word": "Replace the unapproved word with an approved alternative.",
    hedging: "Delete the hedging phrase.",
    marketing: "Replace the phrase with factual language.",
    "paragraph-length": "Split the paragraph into shorter paragraphs.",
    "phrasal-verb": "Replace the phrasal verb with one approved verb.",
    semicolon: "Replace the semicolon with a full stop and write two sentences.",
    "sentence-length": "Split the sentence into shorter sentences.",
    "verb-progressive": "Use a permitted simple verb form.",
    "verb-passive": "Name the actor and use active voice.",
    "verb-perfect": "Use a permitted simple verb form.",
  }
  return fixes[violation.ruleId]
}

function formatViolations(path: string, heading: string, violations: readonly Violation[]): string {
  const details = violations
    .map(
      (violation) =>
        `- line ${violation.line}, column ${violation.column} [${violation.ruleId}]: ${violation.message} Suggested fix: ${suggestedFix(violation)}`,
    )
    .join("\n")
  return `${heading} ${path}:\n${details}`
}

function notifyWarnings(
  ctx: ExtensionContext,
  path: string,
  violations: readonly Violation[],
): void {
  if (violations.length === 0 || !ctx.hasUI) return
  ctx.ui.notify(formatViolations(path, "STE warnings for", violations), "warning")
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
    tagger: state.tagger,
    sourceDialect: classification.sourceDialect,
    previousText,
  })
  const hard = report.violations.filter((violation) => violation.severity === "hard")
  const soft = report.violations.filter((violation) => violation.severity === "soft")
  notifyWarnings(ctx, path, soft)
  if (hard.length === 0) {
    if (soft.length > 0) {
      state.pendingWarnings.set(toolCallId, formatViolations(path, "STE warnings for", soft))
    }
    return undefined
  }
  return {
    block: true,
    reason: formatViolations(path, `STE blocked ${operation} for`, hard),
  }
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
          if (!state.ready) {
            throw new Error(
              `STE check is unavailable: ${state.error ?? "session setup is not complete"}`,
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
          await writeFile(path, content, "utf8")
        },
      },
    })
    return implementation.execute(...args)
  }
  return { ...definition, execute }
}

export default function simpleEnglishExtension(pi: ExtensionAPI): void {
  const state: SessionState = { config: {}, ready: false, pendingWarnings: new Map() }

  pi.on("session_start", async (_event, ctx) => {
    state.ready = false
    state.error = undefined
    state.pendingWarnings.clear()
    pi.registerTool(createGatedEditTool(ctx.cwd, state))
    try {
      state.config = await Effect.runPromise(
        loadConfig(undefined, ctx.cwd, ctx.isProjectTrusted()),
      )
      state.dictionary = await Effect.runPromise(
        loadDictionary(process.env.SIMPLE_ENGLISH_DICTIONARY),
      )
      state.tagger = makeWinkTagger()
      state.ready = true
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error)
      if (ctx.hasUI)
        ctx.ui.notify(`Simple English extension failed to start: ${state.error}`, "error")
    }
  })

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${ruleSummary(state.config)}`,
  }))

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined
    if (!state.ready) {
      return {
        block: true,
        reason: `STE check is unavailable: ${state.error ?? "session setup is not complete"}`,
      }
    }

    if (event.toolName === "write") {
      const input = event.input as WriteToolInput
      if (typeof input.path !== "string" || typeof input.content !== "string") return undefined
      return lintProposedText(state, ctx, "write", event.toolCallId, input.path, input.content)
    }

    return undefined
  })

  pi.on("tool_result", (event) => {
    const warning = state.pendingWarnings.get(event.toolCallId)
    if (warning === undefined) return undefined
    state.pendingWarnings.delete(event.toolCallId)
    return { content: [...event.content, { type: "text" as const, text: warning }] }
  })
}
