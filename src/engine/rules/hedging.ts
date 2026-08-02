import type { Dictionary } from "../../dictionary/schema.ts"
import {
  type CaseFoldedPhrase,
  compileCaseFoldedPhrase,
  scanCaseFoldedPhrases,
} from "../phrase-matcher.ts"
import type { Violation } from "../types.ts"

const phrasesByDictionary = new WeakMap<Dictionary, readonly CaseFoldedPhrase[]>()

const phrasesFor = (dictionary: Dictionary): readonly CaseFoldedPhrase[] => {
  const cached = phrasesByDictionary.get(dictionary)
  if (cached !== undefined) return cached

  const compiled = dictionary.entries.flatMap((entry) =>
    entry.unapproved.map(compileCaseFoldedPhrase),
  )
  phrasesByDictionary.set(dictionary, compiled)
  return compiled
}

export function hedging(lines: readonly string[], dictionary: Dictionary): Violation[] {
  return scanCaseFoldedPhrases(lines, phrasesFor(dictionary)).map((match) => ({
    ruleId: "hedging",
    severity: "soft" as const,
    message: `Do not hedge. Delete "${match.found.toLowerCase()}".`,
    line: match.line,
    column: match.column,
  }))
}
