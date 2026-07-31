import { TOKEN_RUN_PATTERN } from "../tokens.ts"
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

const MARKETING_SET = new Set(MARKETING_WORDS)

interface MarketingMatch {
  readonly found: string
  readonly offset: number
}

function findMarketingLanguage(token: string): MarketingMatch | undefined {
  const normalized = token.toLowerCase()
  if (MARKETING_SET.has(normalized)) {
    return { found: normalized, offset: 0 }
  }

  let offset = 0
  for (const part of normalized.split("-")) {
    if (MARKETING_SET.has(part)) {
      return { found: part, offset }
    }
    offset += part.length + 1
  }
}

export function marketing(lines: readonly string[]): Violation[] {
  return lines.flatMap((line, lineIndex) =>
    Array.from(line.matchAll(TOKEN_RUN_PATTERN)).flatMap((tokenMatch) => {
      const match = findMarketingLanguage(tokenMatch[0])
      if (!match) {
        return []
      }
      return [
        {
          ruleId: "marketing",
          severity: "soft" as const,
          message: `Do not use marketing language. Delete "${match.found}".`,
          line: lineIndex + 1,
          column: tokenMatch.index + match.offset + 1,
        },
      ]
    }),
  )
}
