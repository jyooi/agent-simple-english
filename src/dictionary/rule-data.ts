import type { Dictionary } from "./schema.ts"

export const ruleDataIds = ["phrasal-verb", "hedging", "marketing"] as const

export type RuleDataId = (typeof ruleDataIds)[number]
export type RuleData = Readonly<Partial<Record<RuleDataId, Dictionary>>>
export type RuleDataExtensions = Readonly<Partial<Record<RuleDataId, readonly string[]>>>
