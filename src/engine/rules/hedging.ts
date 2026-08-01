import type { Dictionary } from "../../dictionary/schema.ts"
import { scanLines } from "../scan.ts"
import { TOKEN_CHARACTER_PATTERN } from "../tokens.ts"
import type { Violation } from "../types.ts"

const compilePattern = (dictionary: Dictionary): RegExp =>
  new RegExp(
    `(?<!${TOKEN_CHARACTER_PATTERN})(?:${dictionary.entries
      .flatMap((entry) => entry.unapproved)
      .map((phrase) => phrase.replace(/[\t ]+/g, "\\s+"))
      .join("|")})(?!${TOKEN_CHARACTER_PATTERN})`,
    "gi",
  )

export function hedging(lines: readonly string[], dictionary: Dictionary): Violation[] {
  return scanLines(lines, compilePattern(dictionary)).map((match) => ({
    ruleId: "hedging",
    severity: "soft" as const,
    message: `Do not hedge. Delete "${match.found.toLowerCase()}".`,
    line: match.line,
    column: match.column,
  }))
}
