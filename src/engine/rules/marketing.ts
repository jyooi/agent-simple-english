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

const MARKETING_PATTERN = new RegExp(`\\b(?:${MARKETING_WORDS.join("|")})\\b`, "gi")

export function marketing(lines: readonly string[]): Violation[] {
  return scanLines(lines, MARKETING_PATTERN).map((match) => ({
    ruleId: "marketing",
    severity: "soft" as const,
    message: `Do not use marketing language. Delete "${match.found.toLowerCase()}".`,
    line: match.line,
    column: match.column,
  }))
}
