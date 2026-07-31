const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const INDENTED = /^(?: {4,}|\t)/

const blankLine = (line: string): string => " ".repeat(line.length)

const openingFence = (line: string): string | null => {
  const match = line.match(OPENING_FENCE)
  if (match === null) return null
  const marker = match[1] as string
  const info = match[2] as string
  return marker[0] === "`" && info.includes("`") ? null : marker
}

const closesFence = (line: string, fence: string): boolean => {
  const marker = line.match(CLOSING_FENCE)?.[1]
  return marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length
}

const blankInlineCode = (text: string): string => {
  const output = text.split("")
  let i = 0

  while (i < text.length) {
    if (text[i] !== "`") {
      i++
      continue
    }

    let openerEnd = i + 1
    while (text[openerEnd] === "`") openerEnd++
    const delimiterLength = openerEnd - i
    let candidate = openerEnd
    let closerEnd: number | null = null

    while (candidate < text.length) {
      if (text[candidate] !== "`") {
        candidate++
        continue
      }
      let runEnd = candidate + 1
      while (text[runEnd] === "`") runEnd++
      if (runEnd - candidate === delimiterLength) {
        closerEnd = runEnd
        break
      }
      candidate = runEnd
    }

    if (closerEnd === null) {
      i = openerEnd
      continue
    }
    for (let j = i; j < closerEnd; j++) {
      if (output[j] !== "\n") output[j] = " "
    }
    i = closerEnd
  }

  return output.join("")
}

export function blankMarkdownCode(text: string): string[] {
  let fence: string | null = null
  let afterBlank = true
  let inIndented = false
  const inlineEligible: boolean[] = []
  const lines = text.split("\n").map((line) => {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null
      inlineEligible.push(false)
      return blankLine(line)
    }

    const marker = openingFence(line)
    if (marker !== null) {
      fence = marker
      afterBlank = false
      inIndented = false
      inlineEligible.push(false)
      return blankLine(line)
    }
    if (line.trim() === "") {
      afterBlank = true
      inIndented = false
      inlineEligible.push(false)
      return line
    }
    if (INDENTED.test(line) && (afterBlank || inIndented)) {
      afterBlank = false
      inIndented = true
      inlineEligible.push(false)
      return blankLine(line)
    }
    afterBlank = false
    inIndented = false
    inlineEligible.push(true)
    return line
  })

  let start = 0
  while (start < lines.length) {
    if (!inlineEligible[start]) {
      start++
      continue
    }
    let end = start + 1
    while (end < lines.length && inlineEligible[end]) end++
    const blanked = blankInlineCode(lines.slice(start, end).join("\n")).split("\n")
    for (let i = start; i < end; i++) lines[i] = blanked[i - start] as string
    start = end
  }

  return lines
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
