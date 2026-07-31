import { scanLines } from "../scan.ts"
import { TOKEN_CHARACTER_PATTERN } from "../tokens.ts"
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
  `(?<!${TOKEN_CHARACTER_PATTERN})(?:${HEDGES.map((phrase) => phrase.replace(/ /g, "\\s+")).join("|")})(?!${TOKEN_CHARACTER_PATTERN})`,
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
