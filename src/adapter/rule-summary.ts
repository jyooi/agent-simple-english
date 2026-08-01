import type { SteConfig } from "../config/schema.ts"
import { DEFAULT_MAX_SENTENCE_WORDS } from "../engine/lint.ts"
import type { RuleId } from "../engine/rules/registry.ts"
import type { RuleSetting } from "../engine/types.ts"

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

export const RULE_SUMMARIES: Readonly<Record<RuleId, string>> = {
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

export function resolvedRuleSetting(config: SteConfig, ruleId: RuleId): RuleSetting {
  return config.rules?.[ruleId] ?? DEFAULT_RULE_SETTINGS[ruleId]
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

export function ruleSummary(config: SteConfig): string {
  const maxSentenceWords = config.maxSentenceWords ?? DEFAULT_MAX_SENTENCE_WORDS
  const rules = (Object.keys(RULE_SUMMARIES) as RuleId[])
    .filter((ruleId) => resolvedRuleSetting(config, ruleId) !== "off")
    .map((ruleId) => {
      const summary =
        ruleId === "sentence-length"
          ? `Keep each sentence to ${maxSentenceWords} words or fewer.`
          : RULE_SUMMARIES[ruleId]
      return `- [${resolvedRuleSetting(config, ruleId)}] ${summary}`
    })
    .join("\n")
  return `## Simplified Technical English\n\nFollow these STE rules in prose that you write or edit:\n${rules}\n\nWrites, edits, and git commit messages reject hard violations. Correct the reported text and retry. Soft violations produce warnings.`
}
