export const ruleIds = [
  "sentence-length",
  "verb-progressive",
  "verb-passive",
  "verb-perfect",
] as const

export type RuleId = (typeof ruleIds)[number]
