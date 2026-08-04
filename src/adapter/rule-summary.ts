import type { SteConfig } from "../config/schema.ts"
import { DEFAULT_MAX_SENTENCE_WORDS } from "../engine/lint.ts"
import type { RuleId } from "../engine/rules/registry.ts"
import type { RuleSetting } from "../engine/types.ts"

const DEFAULT_RULE_SETTINGS: Readonly<Record<RuleId, RuleSetting>> = {
  contraction: "hard",
  "dictionary-not-approved-word": "hard",
  hedging: "soft",
  "invalid-suppression": "hard",
  marketing: "soft",
  "paragraph-length": "hard",
  "phrasal-verb": "hard",
  semicolon: "hard",
  "sentence-length": "hard",
  "verb-progressive": "hard",
  "verb-passive": "soft",
  "verb-perfect": "hard",
}

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
  return config.rules?.[ruleId] ?? DEFAULT_RULE_SETTINGS[ruleId]
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

export function ruleSummary(config: SteConfig): string {
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
  const rules =
    sections.length === 0
      ? "No writing rules are enabled."
      : `Apply these enabled rules to prose that you write or edit:\n\n${sections.join("\n\n")}`
  return `## Writing rules\n\n${rules}\n\nWrites, edits, and git commit messages reject hard violations. Correct the reported text and retry. Soft violations produce warnings.`
}
