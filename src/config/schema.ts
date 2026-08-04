import { Effect, ParseResult, Schema } from "effect"
import type { RuleDataExtensions } from "../dictionary/rule-data.ts"
import { type RuleId, ruleIds } from "../engine/rules/registry.ts"
import type { RuleSetting } from "../engine/types.ts"

export interface SteConfig {
  readonly rules?: Partial<Readonly<Record<RuleId, RuleSetting>>>
  readonly maxSentenceWords?: number
  readonly exemptBlockQuotes?: boolean
  readonly ruleDataExtensions?: RuleDataExtensions
  readonly approvedWordsPath?: string
}

const RuleSettingSchema = Schema.Literal("hard", "soft", "off").annotations({
  message: (issue) => ({
    message: `must be "hard", "soft", or "off", got ${JSON.stringify(issue.actual)}`,
    override: true,
  }),
})

const RulesSchema = Schema.partial(
  Schema.Struct(Object.fromEntries(ruleIds.map((id) => [id, RuleSettingSchema]))),
)

const MaxSentenceWordsSchema = Schema.Int.pipe(Schema.positive()).annotations({
  message: (issue) => ({
    message: `must be a positive integer, got ${JSON.stringify(issue.actual)}`,
    override: true,
  }),
})

const ExemptBlockQuotesSchema = Schema.Boolean.annotations({
  message: (issue) => ({
    message: `must be a boolean, got ${JSON.stringify(issue.actual)}`,
    override: true,
  }),
})

const RuleDataExtensionsSchema = Schema.partial(
  Schema.Struct({
    "phrasal-verb": Schema.Array(Schema.NonEmptyTrimmedString),
    hedging: Schema.Array(Schema.NonEmptyTrimmedString),
    marketing: Schema.Array(Schema.NonEmptyTrimmedString),
    "adjectival-participle": Schema.Array(Schema.NonEmptyTrimmedString),
  }),
)

const SteConfigSchema = Schema.Struct({
  rules: Schema.optional(RulesSchema),
  maxSentenceWords: Schema.optional(MaxSentenceWordsSchema),
  exemptBlockQuotes: Schema.optional(ExemptBlockQuotesSchema),
  ruleDataExtensions: Schema.optional(RuleDataExtensionsSchema),
  approvedWordsPath: Schema.optional(Schema.NonEmptyTrimmedString),
})

const decodeUnknown = Schema.decodeUnknown(SteConfigSchema, {
  onExcessProperty: "error",
  errors: "all",
})

export class ConfigError extends Error {
  readonly _tag = "ConfigError"
}

const formatError = (error: ParseResult.ParseError, source: string): string => {
  // Optional fields decode as `T | undefined` unions, so every failure also
  // reports a useless "Expected undefined" branch; drop those.
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error).filter(
    (issue) => !issue.message.startsWith("Expected undefined"),
  )
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
      : `  ${ParseResult.TreeFormatter.formatErrorSync(error)}`
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
