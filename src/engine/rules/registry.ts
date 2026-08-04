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
