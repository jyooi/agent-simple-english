export interface LineMatch {
  readonly found: string
  readonly line: number
  readonly column: number
}

export function scanLines(lines: readonly string[], pattern: RegExp): LineMatch[] {
  return lines.flatMap((line, index) =>
    Array.from(line.matchAll(pattern), (match) => ({
      found: match[0],
      line: index + 1,
      column: match.index + 1,
    })),
  )
}
