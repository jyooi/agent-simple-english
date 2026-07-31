const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const INLINE_CODE = /(`+)[^`]*?\1/g
const INDENTED = /^(?: {4,}|\t)/

// Blanks fenced blocks, indented blocks, and inline code spans, preserving
// line count and the columns of the remaining prose. A fence closes only on
// a fence of the same character at least as long as the opener. An indented
// line counts as code only after a blank line or another indented code line.
export function blankMarkdownCode(text: string): string[] {
  let fence: string | null = null
  let afterBlank = true
  let inIndented = false
  return text.split("\n").map((line) => {
    if (fence !== null) {
      const marker = line.match(FENCE)?.[1]
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null
      }
      return ""
    }
    const marker = line.match(FENCE)?.[1]
    if (marker !== undefined) {
      fence = marker
      afterBlank = false
      inIndented = false
      return ""
    }
    if (line.trim() === "") {
      afterBlank = true
      inIndented = false
      return line
    }
    if (INDENTED.test(line) && (afterBlank || inIndented)) {
      afterBlank = false
      inIndented = true
      return ""
    }
    afterBlank = false
    inIndented = false
    return line.replace(INLINE_CODE, (match) => " ".repeat(match.length))
  })
}

interface BacktickRun {
  readonly start: number
  readonly length: number
}

function blankInlineCodeLine(line: string): string {
  const runs: BacktickRun[] = []
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "`") continue
    const start = index
    while (line[index + 1] === "`") index += 1
    runs.push({ start, length: index - start + 1 })
  }

  const nextMatchingRun = new Int32Array(runs.length).fill(-1)
  const latestRunByLength = new Map<number, number>()
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]
    if (!run) continue
    nextMatchingRun[index] = latestRunByLength.get(run.length) ?? -1
    latestRunByLength.set(run.length, index)
  }

  const masked = line.split("")
  for (let index = 0; index < runs.length; index += 1) {
    const closingIndex = nextMatchingRun[index] ?? -1
    if (closingIndex < 0) continue
    const opening = runs[index]
    const closing = runs[closingIndex]
    if (!opening || !closing) continue

    masked.fill(" ", opening.start, closing.start + closing.length)
    index = closingIndex
  }

  return masked.join("")
}

export function blankInlineCode(lines: readonly string[]): string[] {
  return lines.map(blankInlineCodeLine)
}
