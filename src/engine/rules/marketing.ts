import type { Dictionary } from "../../dictionary/schema.ts"
import { type CaseFoldedToken, caseFoldKey, tokenizeCaseFolded } from "../case-fold.ts"
import {
  type CaseFoldedPhrase,
  compileCaseFoldedPhrase,
  matchPhraseAt,
  type PhraseMatch,
} from "../phrase-matcher.ts"
import type { Violation } from "../types.ts"
import { DEFAULT_SEVERITIES } from "./registry.ts"

interface CompiledMarketingData {
  readonly phrases: readonly CaseFoldedPhrase[]
  readonly componentWords: ReadonlySet<string>
}

const compiledDataByDictionary = new WeakMap<Dictionary, CompiledMarketingData>()

const marketingDataFor = (dictionary: Dictionary): CompiledMarketingData => {
  const cached = compiledDataByDictionary.get(dictionary)
  if (cached !== undefined) return cached

  const phrases = dictionary.entries
    .flatMap((entry) => entry.unapproved)
    .map(compileCaseFoldedPhrase)
    .sort((left, right) => right.words.length - left.words.length)
  const componentWords = new Set(
    phrases.flatMap((phrase) => (phrase.words.length === 1 ? phrase.words : [])),
  )
  const compiled = { phrases, componentWords }
  compiledDataByDictionary.set(dictionary, compiled)
  return compiled
}

// A listed single word inside a hyphenated token ("world-class-ready") still counts.
function findMarketingComponent(
  token: CaseFoldedToken,
  componentWords: ReadonlySet<string>,
): PhraseMatch | undefined {
  let partOffset = 0
  for (const part of token.text.split(/[-‐‑]/u)) {
    if (componentWords.has(caseFoldKey(part))) {
      return { found: part, offset: token.offset + partOffset, tokenCount: 1 }
    }
    partOffset += part.length + 1
  }
}

export function marketing(lines: readonly string[], dictionary: Dictionary): Violation[] {
  const data = marketingDataFor(dictionary)
  const violations: Violation[] = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (line === undefined) continue

    const tokens = tokenizeCaseFolded(line)
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex]
      if (token === undefined) continue

      const match =
        matchPhraseAt(line, tokens, tokenIndex, data.phrases) ??
        findMarketingComponent(token, data.componentWords)
      if (match === undefined) continue

      violations.push({
        ruleId: "marketing",
        severity: DEFAULT_SEVERITIES.marketing,
        message: `Do not use marketing language. Delete "${match.found.toLowerCase()}".`,
        line: lineIndex + 1,
        column: match.offset + 1,
      })
      tokenIndex += match.tokenCount - 1
    }
  }

  return violations
}
