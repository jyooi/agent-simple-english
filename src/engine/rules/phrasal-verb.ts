import { scanLines } from "../scan.ts"
import type { Violation } from "../types.ts"

interface PhrasalVerbEntry {
  readonly forms: readonly string[]
  readonly suggestion: string
}

// List and suggestions follow the pi-ste reference implementation, extended
// with conjugated forms and "carry out" from the HUF-132 spec.
const PHRASAL_VERBS: readonly PhrasalVerbEntry[] = [
  { forms: ["carry out", "carries out", "carried out", "carrying out"], suggestion: "do" },
  { forms: ["spin up", "spins up", "spun up", "spinning up"], suggestion: "start" },
  { forms: ["spin down", "spins down", "spun down", "spinning down"], suggestion: "stop" },
  {
    forms: ["tear down", "tears down", "tore down", "torn down", "tearing down"],
    suggestion: "remove",
  },
  { forms: ["reach out", "reaches out", "reached out", "reaching out"], suggestion: "ask" },
  {
    forms: ["dive into", "dives into", "dived into", "dove into", "diving into"],
    suggestion: "examine",
  },
  { forms: ["kick off", "kicks off", "kicked off", "kicking off"], suggestion: "start" },
  { forms: ["roll out", "rolls out", "rolled out", "rolling out"], suggestion: "release" },
  { forms: ["ramp up", "ramps up", "ramped up", "ramping up"], suggestion: "increase" },
  {
    forms: ["circle back", "circles back", "circled back", "circling back"],
    suggestion: "return to",
  },
  {
    forms: ["drill down", "drills down", "drilled down", "drilling down"],
    suggestion: "examine",
  },
]

const patterns = PHRASAL_VERBS.map((entry) => ({
  suggestion: entry.suggestion,
  pattern: new RegExp(
    `\\b(?:${entry.forms.map((form) => form.replace(/ /g, "\\s+")).join("|")})\\b`,
    "gi",
  ),
}))

export function phrasalVerb(lines: readonly string[]): Violation[] {
  return patterns.flatMap(({ pattern, suggestion }) =>
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
