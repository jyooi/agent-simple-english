import type { Dictionary } from "../../dictionary/schema.ts"
import { scanLines } from "../scan.ts"
import { TOKEN_CHARACTER_PATTERN } from "../tokens.ts"
import type { Violation } from "../types.ts"

interface PhrasalVerbPattern {
  readonly suggestion: string
  readonly pattern: RegExp
}

const patternsByDictionary = new WeakMap<Dictionary, readonly PhrasalVerbPattern[]>()

const compilePatterns = (dictionary: Dictionary): readonly PhrasalVerbPattern[] => {
  const seenPairs = new Set<string>()
  return dictionary.entries.flatMap((entry) => {
    const suggestion = entry.suggestions[0]
    const forms = entry.unapproved.filter((form) => {
      const pair = JSON.stringify([form, suggestion])
      if (seenPairs.has(pair)) return false
      seenPairs.add(pair)
      return true
    })
    if (forms.length === 0) return []

    return [
      {
        suggestion,
        pattern: new RegExp(
          `(?<!${TOKEN_CHARACTER_PATTERN})(?:${forms
            .map((form) => form.replace(/[\t ]+/g, "\\s+"))
            .join("|")})(?!${TOKEN_CHARACTER_PATTERN})`,
          "giu",
        ),
      },
    ]
  })
}

const patternsFor = (dictionary: Dictionary): readonly PhrasalVerbPattern[] => {
  const cached = patternsByDictionary.get(dictionary)
  if (cached !== undefined) return cached

  const compiled = compilePatterns(dictionary)
  patternsByDictionary.set(dictionary, compiled)
  return compiled
}

export function phrasalVerb(lines: readonly string[], dictionary: Dictionary): Violation[] {
  return patternsFor(dictionary).flatMap(({ pattern, suggestion }) =>
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
