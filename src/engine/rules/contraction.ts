import { scanLines } from "../scan.ts"
import type { Violation } from "../types.ts"

const CONTRACTION = /\w+['’](?:t|re|ve|ll|d|m)\b/gi

// `'s` is the only ambiguous case: "repo's" is a possessive, not a
// contraction, so only this fixed set of stems forms a real `'s` contraction.
const CONTRACTION_S =
  /\b(?:it|he|she|that|what|who|there|here|let|one|where|how|everyone|everybody|something|nothing|somebody|nobody)['’]s\b/gi

export function contraction(lines: readonly string[]): Violation[] {
  return [...scanLines(lines, CONTRACTION), ...scanLines(lines, CONTRACTION_S)].map((match) => ({
    ruleId: "contraction",
    severity: "hard" as const,
    message: `Do not use a contraction. Write the words in full. Found "${match.found}".`,
    line: match.line,
    column: match.column,
  }))
}
