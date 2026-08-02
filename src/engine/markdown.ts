import { parse, postprocess, preprocess } from "micromark"

const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const INDENTED = /^(?: {4,}|\t)/
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const LIST_MARKER = /^( {0,3})(?:[-+*]|\d{1,9}[.)])(?:([ \t]{1,4})(?![ \t])|[ \t])/

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

  const blockquotes = consumeBlockquotes(line, base, container.quoteDepth)
  if (blockquotes.depth !== container.quoteDepth) return null

  let index = blockquotes.index
  if (line.slice(index).trim() === "") {
    return { text: "", start: line.length, container }
  }
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

const blankInlineCodeSpans = (text: string): string => {
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
  readonly structuralLines: string[]
  readonly structuralBlanks: boolean[]
}

export function blankMarkdownCodeWithStructure(
  inputLines: readonly string[],
  contentStarts: readonly number[] = inputLines.map(() => 0),
): MarkdownCodeResult {
  let fence: FenceState | null = null
  let activeList: Container | null = null
  let paragraphCanContinue = false
  let inIndented = false
  const inlineEligible: boolean[] = []
  const structuralLines: string[] = []
  const structuralBlanks: boolean[] = []
  const lines = inputLines.map((line, index) => {
    const contentStart = contentStarts[index] ?? 0

    if (fence !== null) {
      const contained = contentWithin(line, contentStart, fence.container)
      if (contained !== null) {
        if (closesFence(contained.text, fence.marker)) {
          fence = null
          paragraphCanContinue = false
          inIndented = false
        }
        inlineEligible.push(false)
        structuralLines.push(blankLine(line))
        structuralBlanks.push(true)
        return blankLine(line)
      }
      fence = null
      paragraphCanContinue = false
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
      paragraphCanContinue = false
      inIndented = false
      inlineEligible.push(false)
      structuralLines.push(blankLine(line))
      structuralBlanks.push(true)
      return blankLine(line)
    }
    if (content.text.trim() === "") {
      paragraphCanContinue = false
      inIndented = false
      inlineEligible.push(false)
      structuralLines.push(line)
      structuralBlanks.push(true)
      return visibleLine
    }
    if (INDENTED.test(content.text) && (!paragraphCanContinue || inIndented)) {
      paragraphCanContinue = false
      inIndented = true
      inlineEligible.push(false)
      structuralLines.push(blankLine(line))
      structuralBlanks.push(true)
      return blankLine(line)
    }
    paragraphCanContinue = !ATX_HEADING.test(content.text)
    inIndented = false
    inlineEligible.push(true)
    structuralLines.push(line)
    structuralBlanks.push(false)
    return visibleLine
  })

  const blankEligibleInlineCode = (target: string[]) => {
    let start = 0
    while (start < target.length) {
      if (!inlineEligible[start]) {
        start++
        continue
      }
      let end = start + 1
      while (end < target.length && inlineEligible[end]) end++
      const blanked = blankInlineCodeSpans(target.slice(start, end).join("\n")).split("\n")
      for (let i = start; i < end; i++) target[i] = blanked[i - start] as string
      start = end
    }
  }

  blankEligibleInlineCode(lines)
  blankEligibleInlineCode(structuralLines)

  return { lines, structuralLines, structuralBlanks }
}

export function blankMarkdownCode(
  inputLines: readonly string[],
  contentStarts: readonly number[] = inputLines.map(() => 0),
): string[] {
  return blankMarkdownCodeWithStructure(inputLines, contentStarts).lines
}

export function maskMarkdownCode(text: string): string {
  return blankMarkdownCode(text.split("\n")).join("\n")
}

const MASKED_MARKDOWN_TOKENS = new Set([
  "autolink",
  "blockQuotePrefix",
  "codeFenced",
  "codeIndented",
  "codeText",
  "characterReference",
  "htmlText",
  "listItemPrefix",
  "reference",
  "resource",
])

const lineStartOffsets = (lines: readonly string[]): readonly number[] => {
  const offsets: number[] = []
  let offset = 0
  for (let index = 0; index < lines.length; index++) {
    offsets.push(offset)
    offset += (lines[index]?.length ?? 0) + (index < lines.length - 1 ? 1 : 0)
  }
  return offsets
}

const lineIndexAtOffset = (offsets: readonly number[], offset: number): number => {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((offsets[middle] ?? Number.POSITIVE_INFINITY) <= offset) low = middle + 1
    else high = middle
  }
  return Math.max(0, low - 1)
}

const blankTextRange = (text: string[], start: number, end: number): void => {
  for (let index = start; index < end; index++) {
    if (text[index] !== "\n") text[index] = " "
  }
}

interface BracketFrame {
  readonly opening: number
  readonly image: boolean
  readonly imageDepth: number
}

interface ResourceCandidate {
  readonly labelStart: number
  readonly sourceStart: number
  sourceEnd?: number
}

interface SourceRange {
  readonly start: number
  readonly end: number
}

interface PreparedMarkdownSource {
  readonly value: string
  readonly resourceCandidates: readonly ResourceCandidate[]
}

const isMarkdownWhitespace = (character: string | undefined): boolean =>
  character === " " || character === "\t" || character === "\n" || character === "\r"

const resourceOpaqueRanges = (source: string, opening: number): readonly SourceRange[] => {
  const ranges: SourceRange[] = []
  let index = opening + 1
  while (isMarkdownWhitespace(source[index])) index++

  if (source[index] === "<") {
    const start = index
    for (index++; index < source.length; index++) {
      if (source[index] === "\\") {
        index++
      } else if (source[index] === "\n" || source[index] === "\r") {
        return ranges
      } else if (source[index] === ">") {
        index++
        ranges.push({ start, end: index })
        break
      }
    }
  } else {
    let depth = 0
    for (; index < source.length; index++) {
      const character = source[index]
      if (character === "\\") {
        index++
      } else if (character === "(") {
        depth++
      } else if (character === ")") {
        if (depth === 0) return ranges
        depth--
      } else if (depth === 0 && isMarkdownWhitespace(character)) {
        break
      }
    }
  }

  const separatorStart = index
  while (isMarkdownWhitespace(source[index])) index++
  if (index === separatorStart) return ranges

  const delimiter = source[index]
  const closing = delimiter === "(" ? ")" : delimiter
  if (delimiter !== '"' && delimiter !== "'" && delimiter !== "(") return ranges

  const start = index
  for (index++; index < source.length; index++) {
    if (source[index] === "\\") {
      index++
    } else if (source[index] === closing) {
      ranges.push({ start, end: index + 1 })
      return ranges
    }
  }
  return ranges
}

const markdownEvents = (source: string) =>
  postprocess(parse().document().write(preprocess()(source, "utf8", true)))

const markdownTextEvents = (source: string) =>
  postprocess(parse().text().write(preprocess()(source, "utf8", true)))

const opaqueInlineProbe = (source: string): string => {
  const characters = source.split("")
  for (let index = 0; index < source.length; index++) {
    if (source.startsWith("<![CDATA[", index)) {
      const end = source.indexOf("]]>", index + 9)
      index = end < 0 ? source.length : end + 2
    } else if (source[index] === "[" || source[index] === "]") {
      characters[index] = "x"
    }
  }
  return characters.join("")
}

const prepareMarkdownSource = (
  source: string,
  delimiterSource: string,
  opaqueInlineRanges: readonly SourceRange[],
): PreparedMarkdownSource => {
  const characters = source.split("")
  const escaped = new Uint8Array(source.length)
  const brackets: BracketFrame[] = []
  const parentheses: number[] = []
  const candidateByOpening = new Map<number, ResourceCandidate>()
  const resourceCandidates: ResourceCandidate[] = []
  const resourceOpaqueEnds = new Int32Array(source.length).fill(-1)
  let imageDepth = 0
  let backslashRun = 0
  let opaqueRangeIndex = 0

  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    const resourceOpaqueEnd = resourceOpaqueEnds[index] ?? -1
    if (resourceOpaqueEnd >= 0) {
      backslashRun = 0
      index = resourceOpaqueEnd - 1
      continue
    }
    while ((opaqueInlineRanges[opaqueRangeIndex]?.end ?? source.length + 1) <= index) {
      opaqueRangeIndex++
    }
    const opaqueRange = opaqueInlineRanges[opaqueRangeIndex]
    if (opaqueRange !== undefined && index >= opaqueRange.start) {
      backslashRun = 0
      index = opaqueRange.end - 1
      continue
    }
    if (delimiterSource[index] !== character && "[]()".includes(character ?? "")) continue
    if (character === "\\") {
      backslashRun++
      continue
    }
    if (backslashRun % 2 !== 0) escaped[index] = 1
    backslashRun = 0
    if (escaped[index] !== 0) continue

    if (character === "[") {
      const image = source[index - 1] === "!" && escaped[index - 1] === 0
      if (image) imageDepth++
      brackets.push({ opening: index, image, imageDepth })
    } else if (character === "]") {
      const frame = brackets.pop()
      if (frame?.image) {
        if (frame.imageDepth > 32 && source[index + 1] === "(") {
          characters[frame.opening] = "x"
          characters[index] = "x"
          const candidate = { labelStart: frame.opening, sourceStart: index + 1 }
          candidateByOpening.set(index + 1, candidate)
          resourceCandidates.push(candidate)
        }
        imageDepth--
      }
    } else if (character === "(") {
      parentheses.push(index)
      if (candidateByOpening.has(index)) {
        for (const range of resourceOpaqueRanges(source, index)) {
          resourceOpaqueEnds[range.start] = range.end
        }
      }
    } else if (character === ")") {
      const opening = parentheses.pop()
      if (opening !== undefined) {
        const candidate = candidateByOpening.get(opening)
        if (candidate !== undefined) candidate.sourceEnd = index + 1
      }
    }
  }

  return { value: characters.join(""), resourceCandidates }
}

const INLINE_BLOCK_TOKENS = new Set(["paragraph", "atxHeadingText", "setextHeadingText"])
const OPAQUE_INLINE_TOKENS = new Set(["autolink", "codeText", "htmlText"])
const HTML_FLOW_SYNTAX_TOKENS = new Set(["characterReference", "htmlText"])

const tokenRanges = (
  events: ReturnType<typeof markdownEvents>,
  tokenTypes: ReadonlySet<string>,
): readonly SourceRange[] => {
  const ranges: SourceRange[] = []
  for (const [phase, token] of events) {
    if (phase === "enter" && tokenTypes.has(token.type)) {
      ranges.push({ start: token.start.offset, end: token.end.offset })
    }
  }
  return ranges
}

const htmlFlowSyntaxRanges = (
  source: string,
  events: ReturnType<typeof markdownEvents>,
): readonly SourceRange[] => {
  const ranges: SourceRange[] = []
  for (const [phase, token] of events) {
    if (phase !== "enter" || token.type !== "htmlFlow") continue
    const start = token.start.offset
    const flowSource = source.slice(start, token.end.offset)
    for (const range of tokenRanges(
      markdownTextEvents(opaqueInlineProbe(flowSource)),
      HTML_FLOW_SYNTAX_TOKENS,
    )) {
      ranges.push({ start: start + range.start, end: start + range.end })
    }
  }
  return ranges
}

const rangeContaining = (ranges: readonly SourceRange[], offset: number): SourceRange | undefined => {
  let low = 0
  let high = ranges.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((ranges[middle]?.start ?? Number.POSITIVE_INFINITY) <= offset) low = middle + 1
    else high = middle
  }
  const range = ranges[low - 1]
  return range !== undefined && offset < range.end ? range : undefined
}

const fallbackResourceRanges = (
  source: string,
  candidates: readonly ResourceCandidate[],
  inlineBlocks: readonly SourceRange[],
  opaqueInlineRanges: readonly SourceRange[],
): readonly SourceRange[] => {
  const chunks: string[] = []
  const segments = new Map<number, { sourceStart: number; syntheticEnd: number }>()
  let syntheticOffset = 0

  for (const candidate of candidates) {
    if (candidate.sourceEnd === undefined) continue
    const inlineBlock = rangeContaining(inlineBlocks, candidate.labelStart)
    if (
      inlineBlock === undefined ||
      candidate.sourceStart < inlineBlock.start ||
      candidate.sourceEnd > inlineBlock.end ||
      rangeContaining(opaqueInlineRanges, candidate.labelStart) !== undefined
    ) {
      continue
    }
    const resource = source.slice(candidate.sourceStart, candidate.sourceEnd)
    const syntheticStart = syntheticOffset + 3
    chunks.push(`[x]${resource}\n\n`)
    syntheticOffset += resource.length + 5
    segments.set(syntheticStart, {
      sourceStart: candidate.sourceStart,
      syntheticEnd: syntheticStart + resource.length,
    })
  }

  if (chunks.length === 0) return []
  const ranges: Array<{ start: number; end: number }> = []
  for (const [phase, token] of markdownEvents(chunks.join(""))) {
    if (phase !== "enter" || token.type !== "resource") continue
    const segment = segments.get(token.start.offset)
    if (segment === undefined || token.end.offset > segment.syntheticEnd) continue
    ranges.push({
      start: segment.sourceStart,
      end: segment.sourceStart + token.end.offset - token.start.offset,
    })
  }
  return ranges
}

export function blankMarkdownDestinations(
  lines: readonly string[],
  contentStarts: readonly number[] = lines.map(() => 0),
): string[] {
  if (lines.length === 0) return []

  const parseLines = lines.map((line, index) =>
    line.slice(Math.min(contentStarts[index] ?? 0, line.length)),
  )
  const source = parseLines.join("\n")
  const sourceLineStarts = lineStartOffsets(parseLines)
  const outputLineStarts = lineStartOffsets(lines)
  const blanked = lines.join("\n").split("")
  const outputOffset = (sourceOffset: number): number => {
    const lineIndex = lineIndexAtOffset(sourceLineStarts, sourceOffset)
    const line = lines[lineIndex] ?? ""
    const contentStart = Math.min(contentStarts[lineIndex] ?? 0, line.length)
    return (
      (outputLineStarts[lineIndex] ?? 0) +
      contentStart +
      sourceOffset -
      (sourceLineStarts[lineIndex] ?? 0)
    )
  }
  const blankSourceRange = (start: number, end: number): void => {
    blankTextRange(blanked, outputOffset(start), outputOffset(end))
  }

  const delimiterEvents = markdownEvents(opaqueInlineProbe(source))
  const opaqueInlineRanges = tokenRanges(delimiterEvents, OPAQUE_INLINE_TOKENS)
  const delimiterCharacters = source.split("")
  for (const range of opaqueInlineRanges) {
    blankTextRange(delimiterCharacters, range.start, range.end)
  }
  const delimiterSource = delimiterCharacters.join("")
  const preparedSource = prepareMarkdownSource(source, delimiterSource, opaqueInlineRanges)
  const events = markdownEvents(preparedSource.value)
  const contentColumns = new Int32Array(parseLines.length).fill(1)
  for (const [phase, token] of events) {
    if (
      phase === "enter" &&
      (token.type === "blockQuotePrefix" ||
        token.type === "listItemPrefix" ||
        token.type === "listItemIndent")
    ) {
      const lineIndex = token.start.line - 1
      contentColumns[lineIndex] = Math.max(
        contentColumns[lineIndex] ?? 1,
        token.end.column,
      )
    }
  }

  const definitionMaskEnds = new Map<number, number>()
  let activeDefinitionStart: number | undefined
  let activeDefinitionLine = 0
  let activeDefinitionContentColumn = 1
  for (const [phase, token] of events) {
    if (phase === "enter" && token.type === "definition") {
      activeDefinitionStart = token.start.offset
      activeDefinitionLine = token.start.line
      activeDefinitionContentColumn = contentColumns[token.start.line - 1] ?? 1
    } else if (
      phase === "enter" &&
      token.type === "definitionTitle" &&
      activeDefinitionStart !== undefined &&
      token.start.line > activeDefinitionLine &&
      token.start.column <=
        Math.max(activeDefinitionContentColumn, contentColumns[token.start.line - 1] ?? 1)
    ) {
      definitionMaskEnds.set(activeDefinitionStart, token.start.offset)
    } else if (phase === "exit" && token.type === "definition") {
      activeDefinitionStart = undefined
    }
  }

  for (const [phase, token] of events) {
    if (phase !== "enter") continue
    if (token.type === "definition") {
      blankSourceRange(
        token.start.offset,
        definitionMaskEnds.get(token.start.offset) ?? token.end.offset,
      )
    } else if (MASKED_MARKDOWN_TOKENS.has(token.type)) {
      blankSourceRange(token.start.offset, token.end.offset)
    }
  }

  for (const range of htmlFlowSyntaxRanges(source, events)) {
    blankSourceRange(range.start, range.end)
  }

  for (const range of fallbackResourceRanges(
    source,
    preparedSource.resourceCandidates,
    tokenRanges(events, INLINE_BLOCK_TOKENS),
    opaqueInlineRanges,
  )) {
    blankSourceRange(range.start, range.end)
  }

  return blanked.join("").split("\n")
}

interface InlineBacktickRun {
  readonly start: number
  readonly length: number
}

function blankInlineCodeLine(line: string): string {
  const runs: InlineBacktickRun[] = []
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

export function proseVisibility(text: string): Uint8Array {
  const visibility = new Uint8Array(text.length)
  const sourceLines = text.split("\n")
  const proseLines = blankMarkdownCode(sourceLines)
  let offset = 0

  for (let index = 0; index < sourceLines.length; index++) {
    const line = sourceLines[index] ?? ""
    if (line === proseLines[index]) {
      visibility.fill(1, offset, offset + line.length)
    }
    offset += line.length
    if (offset < text.length) {
      visibility[offset] = 1
      offset++
    }
  }

  return visibility
}
