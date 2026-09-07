import { Effect, Schema } from "effect"
import type { RuleDataExtensions } from "../dictionary/rule-data.ts"
import { type RuleId, ruleIds } from "../engine/rules/registry.ts"
import type { RuleSetting } from "../engine/types.ts"
import {
  formatParseErrorIssues,
  formatParseErrorTree,
  type ParseError,
} from "../schema/parse-error.ts"
import { NonEmptyTrimmedString } from "../schema/primitives.ts"

export interface SteConfig {
  readonly rules?: Partial<Readonly<Record<RuleId, RuleSetting>>>
  readonly maxSentenceWords?: number
  readonly exemptBlockQuotes?: boolean
  readonly ruleDataExtensions?: RuleDataExtensions
  readonly approvedWordsPath?: string
}

const RuleSettingSchema = Schema.Literals(["hard", "soft", "off"]).annotate({
  expected: '"hard", "soft", or "off"',
})

const RulesSchema = Schema.Struct(
  Object.fromEntries(ruleIds.map((id) => [id, Schema.optionalKey(RuleSettingSchema)])),
)

// One refinement over Unknown, rather than Number plus two checks, so that a
// wrong type and a wrong number both report the same text and the value.
const MaxSentenceWordsSchema = Schema.Unknown.pipe(
  Schema.refine(
    (value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0,
    { expected: "a positive integer" },
  ),
)

const ExemptBlockQuotesSchema = Schema.Boolean

const RuleDataExtensionsSchema = Schema.Struct({
  "phrasal-verb": Schema.optionalKey(Schema.Array(NonEmptyTrimmedString)),
  hedging: Schema.optionalKey(Schema.Array(NonEmptyTrimmedString)),
  marketing: Schema.optionalKey(Schema.Array(NonEmptyTrimmedString)),
  "adjectival-participle": Schema.optionalKey(Schema.Array(NonEmptyTrimmedString)),
})

const SteConfigSchema = Schema.Struct({
  rules: Schema.optionalKey(RulesSchema),
  maxSentenceWords: Schema.optionalKey(MaxSentenceWordsSchema),
  exemptBlockQuotes: Schema.optionalKey(ExemptBlockQuotesSchema),
  ruleDataExtensions: Schema.optionalKey(RuleDataExtensionsSchema),
  approvedWordsPath: Schema.optionalKey(NonEmptyTrimmedString),
})

const decodeUnknown = Schema.decodeUnknownEffect(SteConfigSchema, {
  onExcessProperty: "error",
  errors: "all",
  // v4 omits the rejected value from an issue unless this option is on.
  reportInput: true,
})

export class ConfigError extends Error {
  readonly _tag = "ConfigError"
}

const formatError = (error: ParseError, source: string): string => {
  const issues = formatParseErrorIssues(error)
  const lines = [
    ...new Set(
      issues.map(
        (issue) => `${issue.path.length > 0 ? issue.path.join(".") : "config"}: ${issue.message}`,
      ),
    ),
  ]
  const detail =
    lines.length > 0
      ? lines.map((line) => `  ${line}`).join("\n")
      : `  ${formatParseErrorTree(error)}`
  return `invalid config in ${source}:\n${detail}`
}

export const decodeConfig = (
  input: unknown,
  source: string,
): Effect.Effect<SteConfig, ConfigError> =>
  decodeUnknown(input).pipe(
    Effect.mapError((error) => new ConfigError(formatError(error, source))),
    Effect.map((config) => config as SteConfig),
  )
