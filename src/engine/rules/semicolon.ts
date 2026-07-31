import { scanLines } from "../scan.ts"
import type { Violation } from "../types.ts"

const SEMICOLON = /;/g

export function semicolon(lines: readonly string[]): Violation[] {
  return scanLines(lines, SEMICOLON).map((match) => ({
    ruleId: "semicolon",
    severity: "hard" as const,
    message: "Do not use a semicolon. Write two sentences.",
    line: match.line,
    column: match.column,
  }))
}
