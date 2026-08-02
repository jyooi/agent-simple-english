import type { Dictionary } from "../../dictionary/schema.ts"
import {
  type CaseFoldedPhrase,
  compileCaseFoldedPhrase,
  scanCaseFoldedPhrases,
} from "../phrase-matcher.ts"
import type { Violation } from "../types.ts"

interface PhrasalVerbPattern {
  readonly suggestion: string
  readonly phrases: readonly CaseFoldedPhrase[]
}

const patternsByDictionary = new WeakMap<Dictionary, readonly PhrasalVerbPattern[]>()

const compilePatterns = (dictionary: Dictionary): readonly PhrasalVerbPattern[] => {
  const seenPairs = new Set<string>()
  return dictionary.entries.flatMap((entry) => {
    const suggestion = entry.suggestions[0]
    const phrases = entry.unapproved.flatMap((form) => {
      const phrase = compileCaseFoldedPhrase(form)
      const pair = JSON.stringify([phrase.words, suggestion])
      if (seenPairs.has(pair)) return []

      seenPairs.add(pair)
      return [phrase]
    })
    return phrases.length === 0 ? [] : [{ suggestion, phrases }]
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
  return patternsFor(dictionary).flatMap(({ phrases, suggestion }) =>
    scanCaseFoldedPhrases(lines, phrases).map((match) => ({
      ruleId: "phrasal-verb",
      severity: "hard" as const,
      message: `Do not use a phrasal verb. Use "${suggestion}", not "${match.found.toLowerCase()}".`,
      line: match.line,
      column: match.column,
      suggestion,
    })),
  )
}
