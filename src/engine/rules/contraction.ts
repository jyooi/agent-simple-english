import { scanLines } from "../scan.ts"
import type { Violation } from "../types.ts"
import { DEFAULT_SEVERITIES } from "./registry.ts"

const CONTRACTION = /\b\w+['’](?:t|re|ve|ll|d|m)\b/gi

const S_CONTRACTION_OF_STEM_THAT_IS_NEVER_POSSESSIVE =
  /\b(?:it|he|she|that|what|who|there|here|let|one|where|how|everyone|everybody|something|nothing|somebody|nobody)['’]s\b/gi

export function contraction(lines: readonly string[]): Violation[] {
  return [
    ...scanLines(lines, CONTRACTION),
    ...scanLines(lines, S_CONTRACTION_OF_STEM_THAT_IS_NEVER_POSSESSIVE),
  ].map((match) => ({
    ruleId: "contraction",
    severity: DEFAULT_SEVERITIES.contraction,
    message: `Do not use a contraction. Write the words in full. Found "${match.found}".`,
    line: match.line,
    column: match.column,
  }))
}
