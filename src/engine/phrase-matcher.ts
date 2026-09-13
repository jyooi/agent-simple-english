import { type CaseFoldedToken, caseFoldKey, tokenizeCaseFolded } from "./case-fold.ts"
import type { LineMatch } from "./scan.ts"

export interface CaseFoldedPhrase {
  readonly words: readonly string[]
}

const SAME_LINE_WHITESPACE_PATTERN = /^[^\S\r\n\u2028\u2029]+$/u

export const compileCaseFoldedPhrase = (form: string): CaseFoldedPhrase => ({
  words: form.split(/[\t ]+/u).map(caseFoldKey),
})

const matchesPhrase = (
  line: string,
  tokens: readonly CaseFoldedToken[],
  start: number,
  phrase: CaseFoldedPhrase,
): boolean =>
  phrase.words.every((word, wordIndex) => {
    const token = tokens[start + wordIndex]
    if (token === undefined || token.key !== word) return false
    if (wordIndex === 0) return true

    const previous = tokens[start + wordIndex - 1]
    if (previous === undefined) return false
    return SAME_LINE_WHITESPACE_PATTERN.test(
      line.slice(previous.offset + previous.text.length, token.offset),
    )
  })

export interface PhraseMatch {
  readonly found: string
  readonly offset: number
  readonly tokenCount: number
}

// Longest phrase first when callers sort their list that way.
export function matchPhraseAt(
  line: string,
  tokens: readonly CaseFoldedToken[],
  start: number,
  phrases: readonly CaseFoldedPhrase[],
): PhraseMatch | undefined {
  const first = tokens[start]
  if (first === undefined) return undefined
  const phrase = phrases.find((candidate) => matchesPhrase(line, tokens, start, candidate))
  if (phrase === undefined) return undefined
  const last = tokens[start + phrase.words.length - 1]
  if (last === undefined) return undefined
  return {
    found: line.slice(first.offset, last.offset + last.text.length),
    offset: first.offset,
    tokenCount: phrase.words.length,
  }
}

export function scanCaseFoldedPhrases(
  lines: readonly string[],
  phrases: readonly CaseFoldedPhrase[],
): LineMatch[] {
  const matches: LineMatch[] = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (line === undefined) continue

    const tokens = tokenizeCaseFolded(line)
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const match = matchPhraseAt(line, tokens, tokenIndex, phrases)
      if (match === undefined) continue
      matches.push({ found: match.found, line: lineIndex + 1, column: match.offset + 1 })
      tokenIndex += match.tokenCount - 1
    }
  }

  return matches
}
