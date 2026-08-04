import type { RuleData } from "../dictionary/rule-data.ts"
import type { DictionaryData } from "../dictionary/schema.ts"
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

export interface ReportViolation extends Violation {
  readonly snippet: string
}

export type SourceDialect = "general" | "shell" | "yaml"

export interface LintOptions {
  readonly rules?: Partial<Record<RuleId, RuleSetting>>
  readonly maxSentenceWords?: number
  readonly exemptBlockQuotes?: boolean
  readonly dictionary?: DictionaryData
  readonly ruleData?: RuleData
  // POS tagger for the verb-form rules and POS-aware dictionary entries.
  readonly tagger?: Tagger
  readonly sourceDialect?: SourceDialect
  /**
   * The previous document text used to report only new violations.
   * The engine compares sentence-scoped and paragraph-scoped violations structurally.
   * Omit this value to lint the current document in full.
   * Violation positions refer to the current text.
   */
  readonly previousText?: string
}

export interface LintReport {
  readonly violations: readonly ReportViolation[]
  readonly summary: {
    readonly total: number
    readonly hard: number
  }
}
