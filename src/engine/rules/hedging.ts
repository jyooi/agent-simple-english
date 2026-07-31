import { scanLines } from "../scan.ts"
import type { Violation } from "../types.ts"

const HEDGES = [
  "it is important to note",
  "it should be noted",
  "it is worth noting",
  "please note that",
  "as mentioned",
  "as noted above",
]

const HEDGE_PATTERN = new RegExp(
  `\\b(?:${HEDGES.map((phrase) => phrase.replace(/ /g, "\\s+")).join("|")})\\b`,
  "gi",
)

export function hedging(lines: readonly string[]): Violation[] {
  return scanLines(lines, HEDGE_PATTERN).map((match) => ({
    ruleId: "hedging",
    severity: "soft" as const,
    message: `Do not hedge. Delete "${match.found.toLowerCase()}".`,
    line: match.line,
    column: match.column,
  }))
}
