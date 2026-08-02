import type { Dictionary } from "../../dictionary/schema.ts"
import { scanLines } from "../scan.ts"
import { TOKEN_CHARACTER_PATTERN } from "../tokens.ts"
import type { Violation } from "../types.ts"

interface CompiledHedgingData {
  readonly pattern?: RegExp
}

const compiledDataByDictionary = new WeakMap<Dictionary, CompiledHedgingData>()

const compileHedgingData = (dictionary: Dictionary): CompiledHedgingData => {
  const forms = dictionary.entries.flatMap((entry) => entry.unapproved)
  if (forms.length === 0) return {}

  return {
    pattern: new RegExp(
      `(?<!${TOKEN_CHARACTER_PATTERN})(?:${forms
        .map((phrase) => phrase.replace(/[\t ]+/g, "\\s+"))
        .join("|")})(?!${TOKEN_CHARACTER_PATTERN})`,
      "giu",
    ),
  }
}

const hedgingDataFor = (dictionary: Dictionary): CompiledHedgingData => {
  const cached = compiledDataByDictionary.get(dictionary)
  if (cached !== undefined) return cached

  const compiled = compileHedgingData(dictionary)
  compiledDataByDictionary.set(dictionary, compiled)
  return compiled
}

export function hedging(lines: readonly string[], dictionary: Dictionary): Violation[] {
  const { pattern } = hedgingDataFor(dictionary)
  if (pattern === undefined) return []

  return scanLines(lines, pattern).map((match) => ({
    ruleId: "hedging",
    severity: "soft" as const,
    message: `Do not hedge. Delete "${match.found.toLowerCase()}".`,
    line: match.line,
    column: match.column,
  }))
}
