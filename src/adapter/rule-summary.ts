import type { SteConfig } from "../config/schema.ts"
import { DEFAULT_MAX_SENTENCE_WORDS } from "../engine/lint.ts"
import { DEFAULT_SEVERITIES, type RuleId } from "../engine/rules/registry.ts"
import type { RuleSetting } from "../engine/types.ts"

export const RULE_SUMMARIES: Readonly<Record<RuleId, string>> = {
  contraction: "Do not use contractions. Write the words in full.",
  "dictionary-not-approved-word": "Use approved words from the STE dictionary.",
  hedging: "Remove hedging phrases.",
  "invalid-suppression": "Name registered rule IDs in suppression directives.",
  marketing: "Use factual language instead of marketing language.",
  "paragraph-length": "Use no more than six sentences in one paragraph.",
  "phrasal-verb": "Use an approved single-word verb instead of a phrasal verb.",
  semicolon: "Do not use semicolons. Write two sentences.",
  "sentence-length": "Keep each sentence within the configured word limit.",
  "verb-progressive": "Do not use progressive verb forms.",
  "verb-passive": "Prefer active voice.",
  "verb-perfect": "Do not use perfect verb forms.",
}

export function resolvedRuleSetting(config: SteConfig, ruleId: RuleId): RuleSetting {
  return config.rules?.[ruleId] ?? DEFAULT_SEVERITIES[ruleId]
}

export function formatFailedStatusSummary(
  mode: "disabled" | "enabled" | "strict",
  configError: string,
): string {
  return [
    `Mode: ${mode}`,
    `Config: failed (${configError})`,
    "Rules: unavailable",
    "Dictionary: unavailable",
  ].join("\n")
}

export function formatStatusSummary(
  config: SteConfig,
  mode: "disabled" | "enabled" | "strict",
  dictionary: string,
): string {
  const counts: Record<RuleSetting, number> = { hard: 0, soft: 0, off: 0 }
  for (const ruleId of Object.keys(RULE_SUMMARIES) as RuleId[]) {
    counts[resolvedRuleSetting(config, ruleId)] += 1
  }
  return [
    `Mode: ${mode}`,
    `Rules: ${counts.hard} hard, ${counts.soft} soft, ${counts.off} off`,
    `Dictionary: ${dictionary}`,
  ].join("\n")
}

const HOUSE_STYLE_RULE_IDS: ReadonlySet<RuleId> = new Set(["hedging", "marketing"])
const DIRECTIVE_RULE_IDS: ReadonlySet<RuleId> = new Set(["invalid-suppression"])

function formatRuleGroup(
  heading: string,
  ruleIds: readonly RuleId[],
  config: SteConfig,
  maxSentenceWords: number,
): string | undefined {
  const rules = ruleIds
    .filter((ruleId) => resolvedRuleSetting(config, ruleId) !== "off")
    .map((ruleId) => {
      const summary =
        ruleId === "sentence-length"
          ? `Keep each sentence to ${maxSentenceWords} words or fewer.`
          : RULE_SUMMARIES[ruleId]
      return `- [${resolvedRuleSetting(config, ruleId)}] ${summary}`
    })
  if (rules.length === 0) return undefined
  return `### ${heading}\n\n${rules.join("\n")}`
}

function enabledRuleSections(config: SteConfig): string | undefined {
  const maxSentenceWords = config.maxSentenceWords ?? DEFAULT_MAX_SENTENCE_WORDS
  const ruleIds = Object.keys(RULE_SUMMARIES) as RuleId[]
  const sections = [
    formatRuleGroup(
      "Rules derived from ASD-STE100 Simplified Technical English",
      ruleIds.filter(
        (ruleId) => !HOUSE_STYLE_RULE_IDS.has(ruleId) && !DIRECTIVE_RULE_IDS.has(ruleId),
      ),
      config,
      maxSentenceWords,
    ),
    formatRuleGroup(
      "Directive validation",
      ruleIds.filter((ruleId) => DIRECTIVE_RULE_IDS.has(ruleId)),
      config,
      maxSentenceWords,
    ),
    formatRuleGroup(
      "House-style rules",
      ruleIds.filter((ruleId) => HOUSE_STYLE_RULE_IDS.has(ruleId)),
      config,
      maxSentenceWords,
    ),
  ].filter((section): section is string => section !== undefined)
  return sections.length === 0 ? undefined : sections.join("\n\n")
}

export function ruleSummary(config: SteConfig): string {
  const sections = enabledRuleSections(config)
  const rules =
    sections === undefined
      ? "No writing rules are enabled."
      : `Write all prose in ASD-STE100 Simplified Technical English, including your replies to the user. Apply these enabled rules:\n\n${sections}`
  return `## Writing rules\n\n${rules}\n\nWrites, edits, and git commit messages reject hard violations. Correct the reported text and retry. Soft violations produce warnings. Replies get the same check after you send them.`
}

export function explainRequest(config: SteConfig): string {
  const sections = enabledRuleSections(config)
  const rules = sections === undefined ? "" : `\n\nApply these enabled rules:\n\n${sections}`
  return `## Rewrite request\n\nWrite your last reply again in ASD-STE100 Simplified Technical English. Keep all facts, code, commands, paths, and numbers the same. Do not add new content.${rules}`
}
