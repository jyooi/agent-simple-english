import type { Dictionary } from "../dictionary/schema.ts"
import type { RuleId } from "./rules/registry.ts"
import type { Tagger } from "./tagger.ts"

export type LintKind = "prose-file" | "slash-source" | "hash-source" | "commit-message"

export type Severity = "hard" | "soft"

export type RuleSetting = Severity | "off"

export interface Violation {
  readonly ruleId: RuleId
  readonly severity: Severity
  readonly message: string
  readonly suggestions?: readonly string[]
  readonly line: number
  readonly column: number
  readonly suggestion?: string
}

export type SourceDialect = "general" | "shell"

export interface LintOptions {
  readonly rules?: Partial<Record<RuleId, RuleSetting>>
  readonly maxSentenceWords?: number
  readonly dictionary?: Dictionary
  // POS tagger for the verb-form rules and POS-aware dictionary entries.
  readonly tagger?: Tagger
  readonly sourceDialect?: SourceDialect
  readonly previousText?: string
}

export interface LintReport {
  readonly violations: readonly Violation[]
  readonly summary: {
    readonly total: number
    readonly hard: number
  }
}
