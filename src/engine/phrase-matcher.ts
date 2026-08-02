import {
  caseFoldKey,
  type CaseFoldedToken,
  tokenizeCaseFolded,
} from "./case-fold.ts"
import type { LineMatch } from "./scan.ts"

export interface CaseFoldedPhrase {
  readonly words: readonly string[]
}

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
    return /^[\t ]+$/u.test(line.slice(previous.offset + previous.text.length, token.offset))
  })

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
      const first = tokens[tokenIndex]
      if (first === undefined) continue

      const phrase = phrases.find((candidate) =>
        matchesPhrase(line, tokens, tokenIndex, candidate),
      )
      if (phrase === undefined) continue

      const last = tokens[tokenIndex + phrase.words.length - 1]
      if (last === undefined) continue
      matches.push({
        found: line.slice(first.offset, last.offset + last.text.length),
        line: lineIndex + 1,
        column: first.offset + 1,
      })
      tokenIndex += phrase.words.length - 1
    }
  }

  return matches
}
