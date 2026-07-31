export const ruleIds = [
  "dictionary-not-approved-word",
  "sentence-length",
  "verb-progressive",
  "verb-passive",
  "verb-perfect",
] as const

export type RuleId = (typeof ruleIds)[number]
