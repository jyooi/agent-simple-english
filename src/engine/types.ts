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
}

export interface LintReport {
  readonly violations: readonly Violation[]
  readonly summary: {
    readonly total: number
    readonly hard: number
  }
}
