import type { Dictionary } from "../../dictionary/schema.ts"
import { scanLines } from "../scan.ts"
import { TOKEN_CHARACTER_PATTERN } from "../tokens.ts"
import type { Violation } from "../types.ts"

const compilePattern = (forms: readonly string[]): RegExp =>
  new RegExp(
    `(?<!${TOKEN_CHARACTER_PATTERN})(?:${forms
      .map((phrase) => phrase.replace(/[\t ]+/g, "\\s+"))
      .join("|")})(?!${TOKEN_CHARACTER_PATTERN})`,
    "giu",
  )

export function hedging(lines: readonly string[], dictionary: Dictionary): Violation[] {
  const forms = dictionary.entries.flatMap((entry) => entry.unapproved)
  if (forms.length === 0) return []

  return scanLines(lines, compilePattern(forms)).map((match) => ({
    ruleId: "hedging",
    severity: "soft" as const,
    message: `Do not hedge. Delete "${match.found.toLowerCase()}".`,
    line: match.line,
    column: match.column,
  }))
}
