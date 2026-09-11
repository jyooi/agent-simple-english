import type { Dictionary } from "./schema.ts"

export type RuleDataId = "phrasal-verb" | "hedging" | "marketing" | "adjectival-participle"
export type RuleData = Readonly<Partial<Record<RuleDataId, Dictionary>>>
export type RuleDataExtensions = Readonly<Partial<Record<RuleDataId, readonly string[]>>>
