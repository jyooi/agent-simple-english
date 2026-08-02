import type { Dictionary } from "../../dictionary/schema.ts"
import { TOKEN_RUN_PATTERN } from "../tokens.ts"
import type { Violation } from "../types.ts"

interface MarketingMatch {
  readonly found: string
  readonly offset: number
}

function findMarketingLanguage(
  token: string,
  marketingWords: ReadonlySet<string>,
): MarketingMatch | undefined {
  const normalized = token.toLowerCase()
  if (marketingWords.has(normalized)) {
    return { found: normalized, offset: 0 }
  }

  let offset = 0
  for (const part of normalized.split(/[-‐‑]/u)) {
    if (marketingWords.has(part)) {
      return { found: part, offset }
    }
    offset += part.length + 1
  }
}

export function marketing(lines: readonly string[], dictionary: Dictionary): Violation[] {
  const marketingWords = new Set(
    dictionary.entries.flatMap((entry) => entry.unapproved.map((word) => word.toLowerCase())),
  )
  return lines.flatMap((line, lineIndex) =>
    Array.from(line.matchAll(TOKEN_RUN_PATTERN)).flatMap((tokenMatch) => {
      const match = findMarketingLanguage(tokenMatch[0], marketingWords)
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
