export const ruleIds = [
  "contraction",
  "dictionary-not-approved-word",
  "hedging",
  "invalid-suppression",
  "marketing",
  "paragraph-length",
  "phrasal-verb",
  "semicolon",
  "sentence-length",
  "verb-progressive",
  "verb-passive",
  "verb-perfect",
] as const

export type RuleId = (typeof ruleIds)[number]

export type Severity = "hard" | "soft"

export const DEFAULT_SEVERITIES: Readonly<Record<RuleId, Severity>> = {
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
