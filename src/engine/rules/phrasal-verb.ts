import type { Dictionary } from "../../dictionary/schema.ts"
import { scanLines } from "../scan.ts"
import { TOKEN_CHARACTER_PATTERN } from "../tokens.ts"
import type { Violation } from "../types.ts"

const compilePatterns = (dictionary: Dictionary) =>
  dictionary.entries.map((entry) => ({
    suggestion: entry.suggestions[0],
    pattern: new RegExp(
      `(?<!${TOKEN_CHARACTER_PATTERN})(?:${entry.unapproved
        .map((form) => form.replace(/[\t ]+/g, "\\s+"))
        .join("|")})(?!${TOKEN_CHARACTER_PATTERN})`,
      "giu",
    ),
  }))

export function phrasalVerb(lines: readonly string[], dictionary: Dictionary): Violation[] {
  return compilePatterns(dictionary).flatMap(({ pattern, suggestion }) =>
    scanLines(lines, pattern).map((match) => ({
      ruleId: "phrasal-verb",
      severity: "hard" as const,
      message: `Do not use a phrasal verb. Use "${suggestion}", not "${match.found.toLowerCase()}".`,
      line: match.line,
      column: match.column,
      suggestion,
    })),
  )
}
