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

export function lineOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }
  return offsets
}
