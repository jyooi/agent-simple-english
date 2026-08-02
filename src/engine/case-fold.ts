import { caseFold } from "unicode-case-folding"
import { TOKEN_RUN_PATTERN } from "./tokens.ts"

export interface CaseFoldedToken {
  readonly text: string
  readonly key: string
  readonly offset: number
}

export const caseFoldKey = (text: string): string => caseFold(text)

export const tokenizeCaseFolded = (line: string): readonly CaseFoldedToken[] =>
  Array.from(line.matchAll(TOKEN_RUN_PATTERN), (match) => ({
    text: match[0],
    key: caseFoldKey(match[0]),
    offset: match.index,
  }))
