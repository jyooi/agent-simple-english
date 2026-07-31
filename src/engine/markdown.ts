const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const INDENTED = /^(?: {4,}|\t)/

const blankLine = (line: string): string => " ".repeat(line.length)

interface MarkdownContent {
  readonly text: string
  readonly start: number
}

const markdownContent = (line: string, contentStart: number): MarkdownContent => {
  let index = Math.min(contentStart, line.length)

  while (index < line.length) {
    let marker = index
    let spaces = 0
    while (spaces < 3 && line[marker] === " ") {
      marker++
      spaces++
    }
    if (line[marker] !== ">") break
    index = marker + 1
    if (line[index] === " " || line[index] === "\t") index++
  }

  return { text: line.slice(index), start: index }
}

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

interface BacktickRun {
  readonly start: number
  readonly end: number
  readonly length: number
}

const blankInlineCode = (text: string): string => {
  const output = text.split("")
  const runs: BacktickRun[] = []

  for (let i = 0; i < text.length; ) {
    if (text[i] !== "`") {
      i++
      continue
    }
    let end = i + 1
    while (text[end] === "`") end++
    runs.push({ start: i, end, length: end - i })
    i = end
  }

  const nextMatchingRun = new Array<number | undefined>(runs.length)
  const previousByLength = new Map<number, number>()
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i] as BacktickRun
    const previous = previousByLength.get(run.length)
    if (previous !== undefined) nextMatchingRun[previous] = i
    previousByLength.set(run.length, i)
  }

  for (let i = 0; i < runs.length; ) {
    const closerIndex = nextMatchingRun[i]
    if (closerIndex === undefined) {
      i++
      continue
    }
    const opener = runs[i] as BacktickRun
    const closer = runs[closerIndex] as BacktickRun
    for (let j = opener.start; j < closer.end; j++) {
      if (output[j] !== "\n") output[j] = " "
    }
    i = closerIndex + 1
  }

  return output.join("")
}

export function blankMarkdownCode(
  inputLines: readonly string[],
  contentStarts: readonly number[] = inputLines.map(() => 0),
): string[] {
  let fence: string | null = null
  let afterBlank = true
  let inIndented = false
  const inlineEligible: boolean[] = []
  const lines = inputLines.map((line, index) => {
    const content = markdownContent(line, contentStarts[index] ?? 0)
    const visibleLine = `${" ".repeat(content.start)}${line.slice(content.start)}`

    if (fence !== null) {
      if (closesFence(content.text, fence)) fence = null
      inlineEligible.push(false)
      return blankLine(line)
    }

    const marker = openingFence(content.text)
    if (marker !== null) {
      fence = marker
      afterBlank = false
      inIndented = false
      inlineEligible.push(false)
      return blankLine(line)
    }
    if (content.text.trim() === "") {
      afterBlank = true
      inIndented = false
      inlineEligible.push(false)
      return visibleLine
    }
    if (INDENTED.test(content.text) && (afterBlank || inIndented)) {
      afterBlank = false
      inIndented = true
      inlineEligible.push(false)
      return blankLine(line)
    }
    afterBlank = false
    inIndented = false
    inlineEligible.push(true)
    return visibleLine
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
