import type { RuleData } from "../dictionary/rule-data.ts"
import type { DictionaryData } from "../dictionary/schema.ts"
import type { RuleId, Severity } from "./rules/registry.ts"
import type { Tagger } from "./tagger.ts"

export type LintKind = "prose-file" | "slash-source" | "hash-source" | "html" | "commit-message"

export type { Severity }

export type RuleSetting = Severity | "off"

export interface Violation {
  readonly ruleId: RuleId
  readonly severity: Severity
  readonly message: string
  readonly suggestions?: readonly string[]
  readonly line: number
  readonly column: number
}

export interface ReportViolation extends Violation {
  readonly snippet: string
}

export type SourceDialect =
  | "general"
  | "javascript"
  | "nested-slash"
  | "perl"
  | "ruby"
  | "shell"
  | "yaml"

export interface LintOptions {
  readonly rules?: Partial<Record<RuleId, RuleSetting>>
  readonly maxSentenceWords?: number
  readonly exemptBlockQuotes?: boolean
  readonly dictionary?: DictionaryData
  readonly ruleData?: RuleData
  readonly tagger?: Tagger
  readonly sourceDialect?: SourceDialect
  readonly previousText?: string
}

export interface LintReport {
  readonly violations: readonly ReportViolation[]
  readonly summary: {
    readonly total: number
    readonly hard: number
  }
}
