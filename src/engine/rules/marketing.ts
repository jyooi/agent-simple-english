import { scanLines } from "../scan.ts"
import type { Violation } from "../types.ts"

const MARKETING_WORDS = [
  "seamless",
  "seamlessly",
  "robust",
  "powerful",
  "cutting-edge",
  "effortless",
  "effortlessly",
  "world-class",
  "next-generation",
  "revolutionary",
  "blazing",
  "lightning-fast",
  "elegant",
  "delightful",
  "turnkey",
  "best-in-class",
  "state-of-the-art",
  "game-changing",
  "battle-tested",
  "enterprise-grade",
  "supercharge",
  "unleash",
  "empower",
  "empowers",
]

// A hyphen satisfies \b, so \brobust\b would also match inside "ultra-robust".
// Excluding adjacent hyphens makes hyphenated compounds match only as whole
// tokens.
const MARKETING_PATTERN = new RegExp(`(?<![\\w-])(?:${MARKETING_WORDS.join("|")})(?![\\w-])`, "gi")

export function marketing(lines: readonly string[]): Violation[] {
  return scanLines(lines, MARKETING_PATTERN).map((match) => ({
    ruleId: "marketing",
    severity: "soft" as const,
    message: `Do not use marketing language. Delete "${match.found.toLowerCase()}".`,
    line: match.line,
    column: match.column,
  }))
}
