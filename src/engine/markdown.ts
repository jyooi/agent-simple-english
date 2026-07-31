const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const INDENTED = /^(?: {4,}|\t)/
const LIST_MARKER = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]{1,4})/

const blankLine = (line: string): string => " ".repeat(line.length)

interface Container {
  readonly quoteDepth: number
  readonly listIndent: number
}

interface MarkdownContent {
  readonly text: string
  readonly start: number
  readonly container: Container
}

const consumeBlockquotes = (
  line: string,
  initial: number,
  requiredDepth?: number,
): { index: number; depth: number } => {
  let index = initial
  let depth = 0
  while (index < line.length && (requiredDepth === undefined || depth < requiredDepth)) {
    let marker = index
    let spaces = 0
    while (spaces < 3 && line[marker] === " ") {
      marker++
      spaces++
    }
    if (line[marker] !== ">") break
    depth++
    index = marker + 1
    if (line[index] === " " || line[index] === "\t") index++
  }
  return { index, depth }
}

const markdownContent = (line: string, contentStart: number): MarkdownContent => {
  const base = Math.min(contentStart, line.length)
  const blockquotes = consumeBlockquotes(line, base)
  let index = blockquotes.index
  let listIndent = 0

  while (index < line.length) {
    const match = line.slice(index).match(LIST_MARKER)
    if (match === null) break
    const width = match[0].length
    listIndent += width
    index += width
  }

  return {
    text: line.slice(index),
    start: index,
    container: { quoteDepth: blockquotes.depth, listIndent },
  }
}

const contentWithin = (
  line: string,
  contentStart: number,
  container: Container,
): MarkdownContent | null => {
  const base = Math.min(contentStart, line.length)
  if (container.quoteDepth === 0 && container.listIndent === 0) {
    return { text: line.slice(base), start: base, container }
  }
  if (line.slice(base).trim() === "") {
    return { text: "", start: line.length, container }
  }

  const blockquotes = consumeBlockquotes(line, base, container.quoteDepth)
  if (blockquotes.depth !== container.quoteDepth) return null

  let index = blockquotes.index
  let remaining = container.listIndent
  while (remaining > 0 && (line[index] === " " || line[index] === "\t")) {
    index++
    remaining--
  }
  if (remaining > 0) return null

  return { text: line.slice(index), start: index, container }
}

const fenceLine = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line)

const openingFence = (line: string): string | null => {
  const match = fenceLine(line).match(OPENING_FENCE)
  if (match === null) return null
  const marker = match[1] as string
  const info = match[2] as string
  return marker[0] === "`" && info.includes("`") ? null : marker
}

const closesFence = (line: string, fence: string): boolean => {
  const marker = fenceLine(line).match(CLOSING_FENCE)?.[1]
  return marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length
}

interface BacktickRun {
  readonly start: number
  readonly end: number
  readonly length: number
  readonly escaped: boolean
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
    let backslashes = 0
    for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) backslashes++
    runs.push({ start: i, end, length: end - i, escaped: backslashes % 2 !== 0 })
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
    const opener = runs[i] as BacktickRun
    const closerIndex = nextMatchingRun[i]
    if (opener.escaped || closerIndex === undefined) {
      i++
      continue
    }
    const closer = runs[closerIndex] as BacktickRun
    for (let j = opener.start; j < closer.end; j++) {
      if (output[j] !== "\n") output[j] = " "
    }
    i = closerIndex + 1
  }

  return output.join("")
}

interface FenceState {
  readonly marker: string
  readonly container: Container
}

export interface MarkdownCodeResult {
  readonly lines: string[]
  readonly structuralBlanks: boolean[]
}

export function blankMarkdownCodeWithStructure(
  inputLines: readonly string[],
  contentStarts: readonly number[] = inputLines.map(() => 0),
): MarkdownCodeResult {
  let fence: FenceState | null = null
  let activeList: Container | null = null
  let afterBlank = true
  let inIndented = false
  const inlineEligible: boolean[] = []
  const structuralBlanks: boolean[] = []
  const lines = inputLines.map((line, index) => {
    const contentStart = contentStarts[index] ?? 0

    if (fence !== null) {
      const contained = contentWithin(line, contentStart, fence.container)
      if (contained !== null) {
        if (closesFence(contained.text, fence.marker)) {
          fence = null
          afterBlank = true
          inIndented = false
        }
        inlineEligible.push(false)
        structuralBlanks.push(true)
        return blankLine(line)
      }
      fence = null
      afterBlank = true
      inIndented = false
    }

    let content = markdownContent(line, contentStart)
    if (content.container.listIndent > 0) {
      activeList = content.container
    } else if (content.text.trim() !== "" && activeList !== null) {
      const continued = contentWithin(line, contentStart, activeList)
      if (continued === null) {
        activeList = null
      } else {
        content = continued
      }
    }

    const visibleLine = `${" ".repeat(content.start)}${line.slice(content.start)}`
    const marker = openingFence(content.text)
    if (marker !== null) {
      fence = { marker, container: content.container }
      afterBlank = false
      inIndented = false
      inlineEligible.push(false)
      structuralBlanks.push(true)
      return blankLine(line)
    }
    if (content.text.trim() === "") {
      afterBlank = true
      inIndented = false
      inlineEligible.push(false)
      structuralBlanks.push(true)
      return visibleLine
    }
    if (INDENTED.test(content.text) && (afterBlank || inIndented)) {
      afterBlank = false
      inIndented = true
      inlineEligible.push(false)
      structuralBlanks.push(true)
      return blankLine(line)
    }
    afterBlank = false
    inIndented = false
    inlineEligible.push(true)
    structuralBlanks.push(false)
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

  return { lines, structuralBlanks }
}

export function blankMarkdownCode(
  inputLines: readonly string[],
  contentStarts: readonly number[] = inputLines.map(() => 0),
): string[] {
  return blankMarkdownCodeWithStructure(inputLines, contentStarts).lines
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
