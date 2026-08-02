const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const INDENTED = /^(?: {4,}|\t)/
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*\r?$/
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})\r?$/
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
  readonly contentStarts: number[]
  readonly canStartDefinitions: boolean[]
}

export function blankMarkdownCodeWithStructure(
  inputLines: readonly string[],
  contentStarts: readonly number[] = inputLines.map(() => 0),
): MarkdownCodeResult {
  let fence: FenceState | null = null
  let activeList: Container | null = null
  let paragraphCanContinue = false
  let definitionParagraphOpen = false
  let definitionParagraphContainer: Container | null = null
  let inIndented = false
  const inlineEligible: boolean[] = []
  const structuralLines: string[] = []
  const structuralBlanks: boolean[] = []
  const markdownContentStarts: number[] = []
  const canStartDefinitions: boolean[] = []
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
        markdownContentStarts.push(line.length)
        canStartDefinitions.push(false)
        definitionParagraphOpen = false
        definitionParagraphContainer = null
        return blankLine(line)
      }
      fence = null
      paragraphCanContinue = false
      definitionParagraphOpen = false
      definitionParagraphContainer = null
      inIndented = false
    }

    let content = markdownContent(line, contentStart)
    const startsListItem = content.container.listIndent > 0
    const explicitContainer = content.container
    if (startsListItem) {
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
      markdownContentStarts.push(line.length)
      canStartDefinitions.push(false)
      definitionParagraphOpen = false
      definitionParagraphContainer = null
      return blankLine(line)
    }
    if (content.text.trim() === "") {
      paragraphCanContinue = false
      definitionParagraphOpen = false
      definitionParagraphContainer = null
      inIndented = false
      inlineEligible.push(false)
      structuralLines.push(line)
      structuralBlanks.push(true)
      markdownContentStarts.push(content.start)
      canStartDefinitions.push(false)
      return visibleLine
    }
    if (INDENTED.test(content.text) && (!paragraphCanContinue || inIndented)) {
      paragraphCanContinue = false
      definitionParagraphOpen = false
      definitionParagraphContainer = null
      inIndented = true
      inlineEligible.push(false)
      structuralLines.push(blankLine(line))
      structuralBlanks.push(true)
      markdownContentStarts.push(line.length)
      canStartDefinitions.push(false)
      return blankLine(line)
    }

    const blockBoundary =
      ATX_HEADING.test(content.text) ||
      SETEXT_UNDERLINE.test(content.text) ||
      THEMATIC_BREAK.test(content.text)
    const startsNewContainer =
      startsListItem ||
      (explicitContainer.quoteDepth > 0 &&
        (definitionParagraphContainer === null ||
          explicitContainer.quoteDepth !== definitionParagraphContainer.quoteDepth ||
          explicitContainer.listIndent !== definitionParagraphContainer.listIndent))
    markdownContentStarts.push(content.start)
    canStartDefinitions.push(
      !blockBoundary && (!definitionParagraphOpen || startsNewContainer),
    )
    paragraphCanContinue = !ATX_HEADING.test(content.text)
    definitionParagraphOpen = !blockBoundary
    definitionParagraphContainer = blockBoundary ? null : content.container
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

  return {
    lines,
    structuralLines,
    structuralBlanks,
    contentStarts: markdownContentStarts,
    canStartDefinitions,
  }
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

const blankTextRange = (text: string[], start: number, end: number): void => {
  for (let index = start; index < end; index++) {
    if (text[index] !== "\n") text[index] = " "
  }
}

interface DelimiterFrame {
  readonly opening: number
  nested: boolean
}

interface MarkdownSyntaxIndex {
  readonly escaped: Uint8Array
  readonly parenthesisEnds: Int32Array
  readonly bracketEnds: Int32Array
  readonly bracketStarts: Int32Array
  readonly bracketParents: Int32Array
  readonly bareDestinationEnds: Int32Array
  readonly horizontalWhitespaceEnds: Int32Array
  readonly nextAngleSpecials: Int32Array
  readonly nextDoubleQuotes: Int32Array
  readonly nextSingleQuotes: Int32Array
  readonly blankLineStarts: readonly number[]
}

interface ReferenceDefinition {
  readonly label: string
  readonly start: number
  readonly end: number
}

const isAsciiPunctuation = (character: string | undefined): boolean => {
  if (character === undefined) return false
  const code = character.charCodeAt(0)
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  )
}

const encodedPairEnd = (value: number | undefined): number | undefined =>
  value === undefined || value === 0 ? undefined : Math.abs(value) - 1

const encodedDestinationEnd = (value: number | undefined): number | undefined =>
  value === undefined || value === 0 ? undefined : value - 1

const indexMarkdownSyntax = (
  source: string,
  lines: readonly string[],
): MarkdownSyntaxIndex => {
  const escaped = new Uint8Array(source.length)
  const parenthesisEnds = new Int32Array(source.length)
  const bracketEnds = new Int32Array(source.length)
  const bracketStarts = new Int32Array(source.length)
  const bracketParents = new Int32Array(source.length)
  const parenthesisStack: DelimiterFrame[] = []
  const bracketStack: DelimiterFrame[] = []

  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (
      character === "\\" &&
      escaped[index] === 0 &&
      isAsciiPunctuation(source[index + 1])
    ) {
      escaped[index + 1] = 1
    }
    if (escaped[index] !== 0) continue

    if (character === "(") {
      const parent = parenthesisStack.at(-1)
      if (parent !== undefined) parent.nested = true
      parenthesisStack.push({ opening: index, nested: false })
      continue
    }
    if (character === ")") {
      const frame = parenthesisStack.pop()
      if (frame !== undefined) {
        parenthesisEnds[frame.opening] = frame.nested ? -(index + 1) : index + 1
      }
      continue
    }
    if (character === "[") {
      const parent = bracketStack.at(-1)
      if (parent !== undefined) {
        parent.nested = true
        bracketParents[index] = parent.opening + 1
      }
      bracketStack.push({ opening: index, nested: false })
      continue
    }
    if (character !== "]") continue

    const frame = bracketStack.pop()
    if (frame === undefined) continue
    const label = source.slice(frame.opening + 1, index)
    const validLabel =
      !frame.nested && Array.from(label).length <= 999 && /[^ \t\n\r]/u.test(label)
    bracketEnds[frame.opening] = validLabel ? index + 1 : -(index + 1)
    bracketStarts[index] = frame.opening + 1
  }

  const bareDestinationEnds = new Int32Array(source.length + 1)
  const horizontalWhitespaceEnds = new Int32Array(source.length + 1)
  const nextAngleSpecials = new Int32Array(source.length + 1)
  const nextDoubleQuotes = new Int32Array(source.length + 1)
  const nextSingleQuotes = new Int32Array(source.length + 1)
  horizontalWhitespaceEnds[source.length] = source.length
  bareDestinationEnds[source.length] = source.length + 1
  let nextAngleSpecial = 0
  let nextDoubleQuote = 0
  let nextSingleQuote = 0

  for (let index = source.length - 1; index >= 0; index--) {
    const character = source[index]
    horizontalWhitespaceEnds[index] =
      character === " " || character === "\t"
        ? (horizontalWhitespaceEnds[index + 1] ?? source.length)
        : index

    if (escaped[index] === 0) {
      if (
        character === "<" ||
        character === ">" ||
        character === "\n" ||
        character === "\r"
      ) {
        nextAngleSpecial = index + 1
      }
      if (character === '"') nextDoubleQuote = index + 1
      if (character === "'") nextSingleQuote = index + 1
    }
    nextAngleSpecials[index] = nextAngleSpecial
    nextDoubleQuotes[index] = nextDoubleQuote
    nextSingleQuotes[index] = nextSingleQuote

    if (escaped[index] !== 0) {
      bareDestinationEnds[index] = bareDestinationEnds[index + 1] ?? 0
      continue
    }
    if (character === "(") {
      const closing = encodedPairEnd(parenthesisEnds[index])
      const nestedEnd = encodedDestinationEnd(bareDestinationEnds[index + 1])
      bareDestinationEnds[index] =
        closing !== undefined && nestedEnd === closing
          ? (bareDestinationEnds[closing + 1] ?? 0)
          : 0
      continue
    }
    if (
      character === ")" ||
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r"
    ) {
      bareDestinationEnds[index] = index + 1
      continue
    }
    const code = character?.charCodeAt(0) ?? 0
    bareDestinationEnds[index] =
      character === "<" || character === ">" || code <= 0x1f || code === 0x7f
        ? 0
        : (bareDestinationEnds[index + 1] ?? 0)
  }

  const blankLineStarts: number[] = []
  let lineOffset = 0
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? ""
    const content = line.endsWith("\r") ? line.slice(0, -1) : line
    if (/^[ \t]*$/u.test(content)) blankLineStarts.push(lineOffset)
    lineOffset += line.length + (lineIndex < lines.length - 1 ? 1 : 0)
  }

  return {
    escaped,
    parenthesisEnds,
    bracketEnds,
    bracketStarts,
    bracketParents,
    bareDestinationEnds,
    horizontalWhitespaceEnds,
    nextAngleSpecials,
    nextDoubleQuotes,
    nextSingleQuotes,
    blankLineStarts,
  }
}

const isLineEnding = (character: string | undefined): boolean =>
  character === "\n" || character === "\r"

const lineEndingEnd = (source: string, start: number): number =>
  source[start] === "\r" && source[start + 1] === "\n" ? start + 2 : start + 1

const firstOffsetAtOrAfter = (offsets: readonly number[], target: number): number => {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((offsets[middle] ?? Number.POSITIVE_INFINITY) < target) low = middle + 1
    else high = middle
  }
  return low
}

const hasBlankLine = (
  syntax: MarkdownSyntaxIndex,
  start: number,
  end: number,
): boolean => {
  const blank = syntax.blankLineStarts[firstOffsetAtOrAfter(syntax.blankLineStarts, start)]
  return blank !== undefined && blank < end
}

const markdownWhitespaceEnd = (
  source: string,
  syntax: MarkdownSyntaxIndex,
  start: number,
): number | undefined => {
  let end = syntax.horizontalWhitespaceEnds[start] ?? start
  if (!isLineEnding(source[end])) return end
  end = lineEndingEnd(source, end)
  end = syntax.horizontalWhitespaceEnds[end] ?? end
  return isLineEnding(source[end]) ? undefined : end
}

const markdownAngleDestinationEnd = (
  source: string,
  syntax: MarkdownSyntaxIndex,
  start: number,
): number | undefined => {
  if (source[start] !== "<") return undefined
  const encoded = syntax.nextAngleSpecials[start + 1] ?? 0
  if (encoded === 0) return undefined
  const closing = encoded - 1
  return source[closing] === ">" ? closing + 1 : undefined
}

const markdownLinkTitleEnd = (
  source: string,
  syntax: MarkdownSyntaxIndex,
  start: number,
): number | undefined => {
  const opening = source[start]
  let closing: number | undefined
  if (opening === '"') {
    const encoded = syntax.nextDoubleQuotes[start + 1] ?? 0
    if (encoded !== 0) closing = encoded - 1
  } else if (opening === "'") {
    const encoded = syntax.nextSingleQuotes[start + 1] ?? 0
    if (encoded !== 0) closing = encoded - 1
  } else if (opening === "(") {
    const encoded = syntax.parenthesisEnds[start] ?? 0
    if (encoded > 0) closing = encoded - 1
  }
  if (closing === undefined || hasBlankLine(syntax, start + 1, closing)) return undefined
  return closing + 1
}

const markdownInlineLinkEnd = (
  source: string,
  syntax: MarkdownSyntaxIndex,
  opening: number,
): number | undefined => {
  const destinationStart = markdownWhitespaceEnd(source, syntax, opening + 1)
  if (destinationStart === undefined) return undefined
  if (source[destinationStart] === ")") return destinationStart

  const destinationEnd =
    source[destinationStart] === "<"
      ? markdownAngleDestinationEnd(source, syntax, destinationStart)
      : encodedDestinationEnd(syntax.bareDestinationEnds[destinationStart])
  if (destinationEnd === undefined || destinationEnd === destinationStart) return undefined
  if (source[destinationEnd] === ")") return destinationEnd

  const titleStart = markdownWhitespaceEnd(source, syntax, destinationEnd)
  if (titleStart === undefined || titleStart === destinationEnd) return undefined
  if (source[titleStart] === ")") return titleStart

  const titleEnd = markdownLinkTitleEnd(source, syntax, titleStart)
  if (titleEnd === undefined) return undefined
  const linkEnd = markdownWhitespaceEnd(source, syntax, titleEnd)
  return linkEnd !== undefined && source[linkEnd] === ")" ? linkEnd : undefined
}

const markdownLabelEnd = (
  syntax: MarkdownSyntaxIndex,
  opening: number,
): number | undefined => {
  const encoded = syntax.bracketEnds[opening] ?? 0
  if (encoded <= 0) return undefined
  const closing = encoded - 1
  return hasBlankLine(syntax, opening + 1, closing) ? undefined : closing
}

const normalizeReferenceLabel = (source: string, opening: number, closing: number): string =>
  source
    .slice(opening + 1, closing)
    .replace(/[ \t\n\r]+/gu, " ")
    .trim()
    .toLowerCase()
    .toUpperCase()
    .toLowerCase()

const markdownDefinitionTail = (
  source: string,
  syntax: MarkdownSyntaxIndex,
  destinationEnd: number,
): number | undefined => {
  const sameLineEnd = syntax.horizontalWhitespaceEnds[destinationEnd] ?? destinationEnd
  if (source[sameLineEnd] === undefined) return sameLineEnd

  if (isLineEnding(source[sameLineEnd])) {
    const baseEnd = sameLineEnd
    const nextLineStart = syntax.horizontalWhitespaceEnds[
      lineEndingEnd(source, sameLineEnd)
    ]
    if (nextLineStart === undefined) return baseEnd
    const titleEnd = markdownLinkTitleEnd(source, syntax, nextLineStart)
    if (titleEnd === undefined) return baseEnd
    const trailingEnd = syntax.horizontalWhitespaceEnds[titleEnd] ?? titleEnd
    return source[trailingEnd] === undefined || isLineEnding(source[trailingEnd])
      ? trailingEnd
      : baseEnd
  }

  if (sameLineEnd === destinationEnd) return undefined
  const titleEnd = markdownLinkTitleEnd(source, syntax, sameLineEnd)
  if (titleEnd === undefined) return undefined
  const trailingEnd = syntax.horizontalWhitespaceEnds[titleEnd] ?? titleEnd
  return source[trailingEnd] === undefined || isLineEnding(source[trailingEnd])
    ? trailingEnd
    : undefined
}

const markdownReferenceDefinition = (
  source: string,
  syntax: MarkdownSyntaxIndex,
  start: number,
): ReferenceDefinition | undefined => {
  const labelEnd = markdownLabelEnd(syntax, start)
  if (labelEnd === undefined || source[labelEnd + 1] !== ":") return undefined
  const destinationStart = markdownWhitespaceEnd(source, syntax, labelEnd + 2)
  if (destinationStart === undefined) return undefined

  const destinationEnd =
    source[destinationStart] === "<"
      ? markdownAngleDestinationEnd(source, syntax, destinationStart)
      : encodedDestinationEnd(syntax.bareDestinationEnds[destinationStart])
  if (destinationEnd === undefined || destinationEnd === destinationStart) return undefined
  const end = markdownDefinitionTail(source, syntax, destinationEnd)
  if (end === undefined) return undefined

  return {
    label: normalizeReferenceLabel(source, start, labelEnd),
    start,
    end,
  }
}

const markdownLineOffsets = (lines: readonly string[]): number[] => {
  const offsets: number[] = []
  let nextOffset = 0
  for (let index = 0; index < lines.length; index++) {
    offsets.push(nextOffset)
    nextOffset += (lines[index]?.length ?? 0) + (index < lines.length - 1 ? 1 : 0)
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

const markdownReferenceDefinitions = (
  lines: readonly string[],
  source: string,
  syntax: MarkdownSyntaxIndex,
  contentStarts: readonly number[],
  canStartDefinitions: readonly boolean[],
): readonly ReferenceDefinition[] => {
  const definitions: ReferenceDefinition[] = []
  const offsets = markdownLineOffsets(lines)
  let continuationLine = -1

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const canStart = (canStartDefinitions[lineIndex] ?? true) || lineIndex === continuationLine
    continuationLine = -1
    if (!canStart) continue

    const line = lines[lineIndex] ?? ""
    const lineOffset = offsets[lineIndex] ?? 0
    const contentStart = Math.min(contentStarts[lineIndex] ?? 0, line.length)
    const start = syntax.horizontalWhitespaceEnds[lineOffset + contentStart] ?? source.length
    const contentEnd = lineOffset + (line.endsWith("\r") ? line.length - 1 : line.length)
    if (start >= contentEnd || source[start] !== "[") continue

    const definition = markdownReferenceDefinition(source, syntax, start)
    if (definition === undefined) continue
    definitions.push(definition)
    const endLine = lineIndexAtOffset(offsets, Math.max(definition.start, definition.end - 1))
    continuationLine = endLine + 1
    lineIndex = endLine
  }

  return definitions
}

export function blankMarkdownDestinations(
  lines: readonly string[],
  contentStarts: readonly number[] = lines.map(() => 0),
  canStartDefinitions: readonly boolean[] = lines.map(() => true),
): string[] {
  const source = lines.join("\n")
  const blanked = source.split("")
  const syntax = indexMarkdownSyntax(source, lines)
  const definitions = markdownReferenceDefinitions(
    lines,
    source,
    syntax,
    contentStarts,
    canStartDefinitions,
  )
  const labels = new Set(definitions.map((definition) => definition.label))
  const inactiveLinkOpeners = new Uint8Array(source.length)
  const isImageOpener = (opening: number): boolean =>
    source[opening - 1] === "!" && syntax.escaped[opening - 1] === 0
  const deactivateParentLinks = (opening: number): void => {
    if (isImageOpener(opening)) return
    let encodedParent = syntax.bracketParents[opening] ?? 0
    while (encodedParent !== 0) {
      const parent = encodedParent - 1
      if (!isImageOpener(parent)) inactiveLinkOpeners[parent] = 1
      encodedParent = syntax.bracketParents[parent] ?? 0
    }
  }

  for (const definition of definitions) {
    blankTextRange(blanked, definition.start, definition.end)
  }

  for (let index = 0; index < source.length; index++) {
    if (source[index] !== "]" || syntax.escaped[index] !== 0) continue
    const encodedOpening = syntax.bracketStarts[index] ?? 0
    if (encodedOpening === 0) continue
    const opening = encodedOpening - 1
    if (inactiveLinkOpeners[opening] !== 0 || hasBlankLine(syntax, opening + 1, index)) continue

    const suffixStart = index + 1
    if (source[suffixStart] === "(") {
      const linkEnd = markdownInlineLinkEnd(source, syntax, suffixStart)
      if (linkEnd === undefined) continue
      blankTextRange(blanked, suffixStart, linkEnd + 1)
      deactivateParentLinks(opening)
      index = linkEnd
      continue
    }
    if (source[suffixStart] !== "[") continue

    const referenceEnd = encodedPairEnd(syntax.bracketEnds[suffixStart])
    if (referenceEnd === undefined) continue
    const labelEnd = markdownLabelEnd(syntax, suffixStart)
    const collapsed = referenceEnd === suffixStart + 1
    const resolves = collapsed
      ? markdownLabelEnd(syntax, opening) === index &&
        labels.has(normalizeReferenceLabel(source, opening, index))
      : labelEnd === referenceEnd &&
        labels.has(normalizeReferenceLabel(source, suffixStart, referenceEnd))
    if (!resolves) continue

    blankTextRange(blanked, suffixStart, referenceEnd + 1)
    deactivateParentLinks(opening)
    index = referenceEnd
  }

  for (const pattern of [
    /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*|[^<>\s@]+@[^<>\s@]+)>/gu,
    /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<]+/gu,
  ]) {
    for (const match of source.matchAll(pattern)) {
      blankTextRange(blanked, match.index, match.index + match[0].length)
    }
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
