import { scanLines } from "../scan.ts"
import type { Violation } from "../types.ts"
import { DEFAULT_SEVERITIES } from "./registry.ts"

const SEMICOLON = /;/g

export function semicolon(lines: readonly string[]): Violation[] {
  return scanLines(lines, SEMICOLON).map((match) => ({
    ruleId: "semicolon",
    severity: DEFAULT_SEVERITIES.semicolon,
    message: "Do not use a semicolon. Write two sentences.",
    line: match.line,
    column: match.column,
  }))
}
