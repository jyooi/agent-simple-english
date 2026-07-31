import type { Tagger } from "./tagger.ts"

export type LintKind = "prose-file"

export type Severity = "hard" | "soft"

export interface Violation {
  readonly ruleId: string
  readonly severity: Severity
  readonly message: string
  readonly line: number
  readonly column: number
}

export interface LintOptions {
  readonly maxSentenceWords?: number
  // POS tagger for the verb-form rules; when absent those rules do not run.
  readonly tagger?: Tagger
}

export interface LintReport {
  readonly violations: readonly Violation[]
  readonly summary: {
    readonly total: number
    readonly hard: number
  }
}
