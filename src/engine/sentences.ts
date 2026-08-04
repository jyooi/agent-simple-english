import { isParagraphBoundaryLine } from "./paragraphs.ts"

export interface Sentence {
  readonly text: string
  readonly line: number
  readonly column: number
  readonly endLine: number
  readonly startOffset: number
  readonly endOffset: number
  readonly contentRanges: readonly {
    readonly start: number
    readonly end: number
  }[]
}

const QUOTATION_CLOSERS = new Set(['"', "'", "’", "”", "»", "›"])
const OPENING_PROSE_DELIMITERS = new Set(["(", "{", "‘", "“", "«", "‹"])
const CLOSING_DELIMITERS = new Set([...QUOTATION_CLOSERS, ")", "]", "}", "*", "_", "~", "`"])

function valueAt(values: Int32Array | Uint32Array, index: number): number {
  const value = values[index]
  if (value === undefined) throw new RangeError(`Array index ${index} is out of bounds`)
  return value
}

function sentinelAt(values: Int32Array, index: number): number {
  return values[index] ?? -1
}

function markdownDelimiterEnds(text: string): {
  readonly parentheses: Int32Array
  readonly brackets: Int32Array
  readonly linkSuffixes: Int32Array
} {
  const parentheses = new Int32Array(text.length).fill(-1)
  const brackets = new Int32Array(text.length).fill(-1)
  const linkSuffixes = new Int32Array(text.length).fill(-1)
  const parenthesisStack: number[] = []
  const bracketStack: number[] = []
  let opaqueDelimiter: string | undefined

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (opaqueDelimiter !== undefined) {
      if (character === "\\") {
        index += 1
      } else if (character === opaqueDelimiter) {
        opaqueDelimiter = undefined
      }
      continue
    }

    switch (character) {
      case "\\":
        index += 1
        break
      case '"':
      case "'": {
        const opening = parenthesisStack[parenthesisStack.length - 1]
        const isLinkTitle =
          opening !== undefined && text[opening - 1] === "]" && /\s/.test(text[index - 1] ?? "")
        if (isLinkTitle) opaqueDelimiter = character
        break
      }
      case "<": {
        const opening = parenthesisStack[parenthesisStack.length - 1]
        const isAngleDestination =
          opening !== undefined && text[opening - 1] === "]" && index === opening + 1
        if (isAngleDestination) opaqueDelimiter = ">"
        break
      }
      case "(":
        parenthesisStack.push(index)
        break
      case ")": {
        const opening = parenthesisStack.pop()
        if (opening !== undefined) parentheses[opening] = index + 1
        break
      }
      case "[":
        bracketStack.push(index)
        break
      case "]": {
        const opening = bracketStack.pop()
        if (opening !== undefined) brackets[opening] = index + 1
        break
      }
    }
  }

  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] !== "]") continue
    const suffixStart = index + 1
    const parenthesisEnd = valueAt(parentheses, suffixStart)
    const bracketEnd = valueAt(brackets, suffixStart)
    if (text[suffixStart] === "(" && parenthesisEnd >= 0) {
      linkSuffixes[suffixStart] = parenthesisEnd
    } else if (text[suffixStart] === "[" && bracketEnd >= 0) {
      linkSuffixes[suffixStart] = bracketEnd
    }
  }

  return { parentheses, brackets, linkSuffixes }
}

const ABBREVIATIONS = ["e.g.", "i.e.", "etc.", "vs.", "Fig.", "No."] as const
type ListedAbbreviation = (typeof ABBREVIATIONS)[number]

const DESIGNATOR_ABBREVIATIONS: ReadonlySet<ListedAbbreviation> = new Set(["Fig.", "No."])

interface BoundaryAnalysis {
  readonly escaped: Uint8Array
  readonly nextAttachedContent: Int32Array
  readonly underscoreClosers: readonly [Int32Array, Int32Array, Int32Array]
}

function escapedCharacters(text: string): Uint8Array {
  const escaped = new Uint8Array(text.length)
  let backslashes = 0
  for (let index = 0; index < text.length; index += 1) {
    escaped[index] = backslashes % 2
    backslashes = text[index] === "\\" ? backslashes + 1 : 0
  }
  return escaped
}

function underscoreEmphasisClosers(
  text: string,
  escaped: Uint8Array,
): readonly [Int32Array, Int32Array, Int32Array] {
  const closers = [1, 2, 3].map(() => new Int32Array(text.length + 1).fill(-1)) as unknown as [
    Int32Array,
    Int32Array,
    Int32Array,
  ]
  const nearest = [-1, -1, -1]
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text[index] === "_" && text[index - 1] !== "_") {
      let runEnd = index + 1
      while (text[runEnd] === "_") runEnd += 1
      const delimiterLength = runEnd - index
      if (
        delimiterLength <= 3 &&
        escaped[index] === 0 &&
        !/\s/u.test(text[index - 1] ?? "") &&
        !/[\p{L}\p{N}_]/u.test(text[runEnd] ?? "")
      ) {
        nearest[delimiterLength - 1] = index
      }
    }
    for (let length = 0; length < closers.length; length += 1) {
      const closer = closers[length]
      if (closer !== undefined) closer[index] = nearest[length] ?? -1
    }
  }
  return closers
}

function atxHeadingPrefixes(text: string): Uint8Array {
  const prefixes = new Uint8Array(text.length)
  let lineStart = 0

  for (let lineEnd = 0; lineEnd <= text.length; lineEnd += 1) {
    if (lineEnd < text.length && text[lineEnd] !== "\n") continue

    let markerStart = lineStart
    while (markerStart < lineEnd && markerStart - lineStart < 3 && text[markerStart] === " ") {
      markerStart += 1
    }
    let markerEnd = markerStart
    while (markerEnd < lineEnd && markerEnd - markerStart < 6 && text[markerEnd] === "#") {
      markerEnd += 1
    }
    if (
      markerEnd > markerStart &&
      text[markerEnd] !== "#" &&
      (markerEnd === lineEnd || /[ \t]/u.test(text[markerEnd] ?? ""))
    ) {
      prefixes.fill(1, markerStart, markerEnd)
    }
    lineStart = lineEnd + 1
  }

  return prefixes
}

function contentLookahead(
  text: string,
  brackets: Int32Array,
  linkSuffixes: Int32Array,
): Int32Array {
  const attached = new Int32Array(text.length + 1).fill(-1)
  const detached = new Int32Array(text.length + 1).fill(-1)
  const headingPrefixes = atxHeadingPrefixes(text)

  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index] ?? ""
    if (/\s/u.test(character) || headingPrefixes[index] === 1) {
      attached[index] = sentinelAt(detached, index + 1)
      detached[index] = sentinelAt(detached, index + 1)
      continue
    }
    if (CLOSING_DELIMITERS.has(character)) {
      attached[index] = sentinelAt(attached, index + 1)
      detached[index] = sentinelAt(detached, index + 1)
      continue
    }

    const linkSuffixEnd = sentinelAt(linkSuffixes, index)
    if (linkSuffixEnd >= 0) {
      attached[index] = sentinelAt(attached, linkSuffixEnd)
      detached[index] = sentinelAt(detached, linkSuffixEnd)
      continue
    }

    const bracketEnd = sentinelAt(brackets, index)
    if (character === "[" && bracketEnd >= 0) {
      attached[index] = sentinelAt(attached, bracketEnd)
      detached[index] = sentinelAt(detached, index + 1)
      continue
    }
    if (character === "[" || OPENING_PROSE_DELIMITERS.has(character)) {
      attached[index] = sentinelAt(attached, index + 1)
      detached[index] = sentinelAt(detached, index + 1)
      continue
    }

    attached[index] = index
    detached[index] = index
  }

  return attached
}

function analyzeBoundaryText(text: string): BoundaryAnalysis {
  const { brackets, linkSuffixes } = markdownDelimiterEnds(text)
  const escaped = escapedCharacters(text)
  return {
    escaped,
    nextAttachedContent: contentLookahead(text, brackets, linkSuffixes),
    underscoreClosers: underscoreEmphasisClosers(text, escaped),
  }
}

function hasUnderscoreEmphasisOpening(
  text: string,
  tokenStart: number,
  tokenEnd: number,
  analysis: BoundaryAnalysis,
): boolean {
  if (text[tokenStart - 1] !== "_") return false

  let openingStart = tokenStart - 1
  while (text[openingStart - 1] === "_") openingStart -= 1
  const delimiterLength = tokenStart - openingStart
  if (
    delimiterLength > 3 ||
    /[\p{L}\p{N}_]/u.test(text[openingStart - 1] ?? "") ||
    analysis.escaped[openingStart] === 1
  ) {
    return false
  }

  const closers = analysis.underscoreClosers[delimiterLength - 1]
  return closers !== undefined && (closers[tokenEnd + 1] ?? -1) >= 0
}

function hasTokenStartBoundary(
  text: string,
  tokenStart: number,
  tokenEnd: number,
  analysis: BoundaryAnalysis,
): boolean {
  const previous = text[tokenStart - 1] ?? ""
  return (
    !/[\p{L}\p{N}_.]/u.test(previous) ||
    (previous === "_" && hasUnderscoreEmphasisOpening(text, tokenStart, tokenEnd, analysis))
  )
}

function listedAbbreviationAtPeriod(
  text: string,
  periodIndex: number,
  analysis: BoundaryAnalysis,
): { readonly abbreviation: ListedAbbreviation; readonly start: number } | undefined {
  for (const abbreviation of ABBREVIATIONS) {
    const start = periodIndex - abbreviation.length + 1
    if (start < 0 || text.slice(start, periodIndex + 1) !== abbreviation) continue
    if (hasTokenStartBoundary(text, start, periodIndex, analysis)) {
      return { abbreviation, start }
    }
  }

  return undefined
}

function isCapitalInitialAtPeriod(
  maskedText: string,
  localPeriodIndex: number,
  boundaryText: string,
  boundaryPeriodIndex: number,
  analysis: BoundaryAnalysis,
): boolean {
  const localInitialStart = localPeriodIndex - 1
  const boundaryInitialStart = boundaryPeriodIndex - 1
  return (
    /[A-Z]/u.test(maskedText[localInitialStart] ?? "") &&
    hasTokenStartBoundary(boundaryText, boundaryInitialStart, boundaryPeriodIndex, analysis)
  )
}

interface NextContent {
  readonly character: string
  readonly word: string
}

function nextContentIn(
  text: string,
  start: number,
  end: number,
  nextAttachedContent: Int32Array,
): NextContent | undefined {
  const index = sentinelAt(nextAttachedContent, start)
  if (index < 0 || index >= end) return undefined

  const character = text[index] ?? ""
  let wordEnd = index
  while (wordEnd < end && /[\p{L}\p{N}_-]/u.test(text[wordEnd] ?? "")) wordEnd += 1
  return { character, word: text.slice(index, wordEnd) || character }
}

function isCodeDesignator(abbreviation: ListedAbbreviation, next: NextContent): boolean {
  if (/\d/u.test(next.word)) return /^[A-Z0-9](?:[A-Z0-9-]{0,2})$/u.test(next.word)
  if (abbreviation === "No.") return /^[A-Z]$/u.test(next.word)
  return /^[A-Z](?:[A-Z-]{0,2})$/u.test(next.word)
}

function abbreviationIsInternal(
  maskedText: string,
  localPeriodIndex: number,
  boundaryText: string,
  boundaryPeriodIndex: number,
  paragraphEnd: number,
  analysis: BoundaryAnalysis,
): boolean {
  const listed = listedAbbreviationAtPeriod(boundaryText, boundaryPeriodIndex, analysis)
  const isInitial = isCapitalInitialAtPeriod(
    maskedText,
    localPeriodIndex,
    boundaryText,
    boundaryPeriodIndex,
    analysis,
  )
  if (listed === undefined && !isInitial) return false

  const next = nextContentIn(
    boundaryText,
    boundaryPeriodIndex + 1,
    paragraphEnd,
    analysis.nextAttachedContent,
  )
  if (next === undefined) return paragraphEnd >= boundaryText.length
  if (!/[A-Z]/u.test(next.character)) return true
  if (QUOTATION_CLOSERS.has(boundaryText[boundaryPeriodIndex + 1] ?? "")) return false
  if (listed !== undefined && DESIGNATOR_ABBREVIATIONS.has(listed.abbreviation)) {
    return isCodeDesignator(listed.abbreviation, next)
  }
  return isInitial
}

// Identifier masking blanks dotted abbreviations but leaves their final periods.
// Restore only listed abbreviations from the equal-length pre-identifier line.
function restoreAbbreviations(
  text: string,
  boundaryLine: string,
  boundaryText: string,
  boundaryOffset: number,
  analysis: BoundaryAnalysis,
): string {
  const characters = text.split("")
  let changed = false

  for (let index = 0; index < boundaryLine.length; index += 1) {
    if (boundaryLine[index] !== "." || text[index] !== ".") continue
    const listed = listedAbbreviationAtPeriod(boundaryText, boundaryOffset + index, analysis)
    if (listed === undefined) continue
    const localStart = listed.start - boundaryOffset
    for (let characterIndex = localStart; characterIndex <= index; characterIndex += 1) {
      characters[characterIndex] = boundaryLine[characterIndex] ?? ""
    }
    changed = true
  }

  return changed ? characters.join("") : text
}

function sentenceTerminatorEnds(
  text: string,
  boundaryText: string,
  boundaryOffset: number,
  paragraphEnd: number,
  boundaryAnalysis: BoundaryAnalysis,
): number[] {
  const { parentheses, brackets, linkSuffixes } = markdownDelimiterEnds(text)
  const closingRuns = new Uint32Array(text.length + 1)
  const closingBracketCounts = new Uint32Array(text.length + 1)
  const referenceRuns = new Int32Array(text.length).fill(-1)
  const ends: number[] = []
  closingRuns[text.length] = text.length

  for (let index = text.length - 1; index >= 0; index -= 1) {
    closingRuns[index] = CLOSING_DELIMITERS.has(text[index] ?? "")
      ? valueAt(closingRuns, index + 1)
      : index
    closingBracketCounts[index] =
      valueAt(closingBracketCounts, index + 1) + (text[index] === "]" ? 1 : 0)
  }

  for (let index = text.length - 1; index >= 0; index -= 1) {
    const bracketEnd = valueAt(brackets, index)
    if (text[index] !== "[" || bracketEnd < 0) continue
    let end = valueAt(closingRuns, bracketEnd)
    const referenceEnd = sentinelAt(referenceRuns, end)
    if (text[end] === "[" && referenceEnd >= 0) end = referenceEnd
    referenceRuns[index] = end
  }

  for (let index = 0; index < text.length; index += 1) {
    const linkSuffixEnd = valueAt(linkSuffixes, index)
    if (linkSuffixEnd >= 0) {
      index = linkSuffixEnd - 1
      continue
    }
    if (text[index] !== "." && text[index] !== "!" && text[index] !== "?") continue

    let punctuationEnd = index + 1
    while (
      text[punctuationEnd] === "." ||
      text[punctuationEnd] === "!" ||
      text[punctuationEnd] === "?"
    ) {
      punctuationEnd += 1
    }
    if (
      punctuationEnd === index + 1 &&
      text[index] === "." &&
      abbreviationIsInternal(
        text,
        index,
        boundaryText,
        boundaryOffset + index,
        paragraphEnd,
        boundaryAnalysis,
      )
    ) {
      continue
    }

    let end = valueAt(closingRuns, punctuationEnd)
    const closedLinkLabel =
      valueAt(closingBracketCounts, punctuationEnd) > valueAt(closingBracketCounts, end)

    if (closedLinkLabel && text[end] === "(") {
      const parenthesisEnd = valueAt(parentheses, end)
      if (parenthesisEnd < 0) {
        index = punctuationEnd - 1
        continue
      }
      end = valueAt(closingRuns, parenthesisEnd)
    }

    const referenceEnd = sentinelAt(referenceRuns, end)
    if (text[end] === "[" && referenceEnd >= 0) end = referenceEnd
    if (end === text.length || /\s/.test(text[end] ?? "")) {
      ends.push(end)
      index = end - 1
    } else {
      index = punctuationEnd - 1
    }
  }

  return ends
}

// A sentence starts at the first non-whitespace character and ends at
// terminal punctuation and closing delimiters, at a blank line, or at EOF.
// Sentences may span lines; position is where the sentence starts (1-based).
export function segmentSentences(
  lines: readonly string[],
  sourceText: string = lines.join("\n"),
  structuralBlanks: readonly boolean[] = lines.map((line) => line.trim() === ""),
  boundaryLines: readonly string[] = lines,
  sentenceBoundaryLines: readonly boolean[] = lines.map(() => false),
): Sentence[] {
  const sentences: Sentence[] = []
  const lineOffsets = [0]
  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText[index] === "\n") lineOffsets.push(index + 1)
  }
  const effectiveBoundaryLines = lines.map((line, index) => boundaryLines[index] ?? line)
  const boundaryText = effectiveBoundaryLines.join("\n")
  const boundaryAnalysis = analyzeBoundaryText(boundaryText)
  const boundaryOffsets: number[] = []
  const paragraphEnds: number[] = []
  const lookaheadBreaks = effectiveBoundaryLines.map(
    (line, index) =>
      (structuralBlanks[index] ?? true) ||
      (sentenceBoundaryLines[index] ?? false) ||
      isParagraphBoundaryLine(line),
  )
  let boundaryOffset = 0
  for (const line of effectiveBoundaryLines) {
    boundaryOffsets.push(boundaryOffset)
    boundaryOffset += line.length + 1
  }
  let paragraphEnd = boundaryText.length
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    paragraphEnds[index] = paragraphEnd
    if (lookaheadBreaks[index] ?? true) paragraphEnd = boundaryOffsets[index] ?? paragraphEnd
  }
  let open: {
    line: number
    column: number
    endLine: number
    startOffset: number
    endOffset: number
    parts: string[]
    contentRanges: Array<{ start: number; end: number }>
  } | null = null

  const appendPart = (part: string, startOffset: number) => {
    if (!open) return
    const leadingWhitespace = part.length - part.trimStart().length
    const text = part.trim()
    open.parts.push(text)
    if (text === "") return
    const start = startOffset + leadingWhitespace
    const end = start + text.length
    open.contentRanges.push({ start, end })
    open.endOffset = end
  }

  const close = () => {
    if (!open) return
    const text = open.parts.join(" ").trim()
    if (text !== "") {
      sentences.push({
        text,
        line: open.line,
        column: open.column,
        endLine: open.endLine,
        startOffset: open.startOffset,
        endOffset: open.endOffset,
        contentRanges: open.contentRanges,
      })
    }
    open = null
  }

  lines.forEach((maskedRaw, index) => {
    if (maskedRaw.trim() === "") {
      if (structuralBlanks[index] ?? true) close()
      return
    }
    const boundaryRaw = effectiveBoundaryLines[index] ?? maskedRaw
    const currentBoundaryOffset = boundaryOffsets[index] ?? 0
    const raw = restoreAbbreviations(
      maskedRaw,
      boundaryRaw,
      boundaryText,
      currentBoundaryOffset,
      boundaryAnalysis,
    )
    let offset = 0
    for (const end of sentenceTerminatorEnds(
      raw,
      boundaryText,
      currentBoundaryOffset,
      paragraphEnds[index] ?? boundaryText.length,
      boundaryAnalysis,
    )) {
      const part = raw.slice(offset, end)
      if (!open) {
        const indent = part.length - part.trimStart().length
        const startOffset = (lineOffsets[index] ?? 0) + offset + indent
        open = {
          line: index + 1,
          column: offset + indent + 1,
          endLine: index + 1,
          startOffset,
          endOffset: startOffset,
          parts: [],
          contentRanges: [],
        }
      }
      open.endLine = index + 1
      appendPart(part, (lineOffsets[index] ?? 0) + offset)
      close()
      offset = end
    }

    const rest = raw.slice(offset)
    if (rest.trim() !== "") {
      if (!open) {
        const indent = rest.length - rest.trimStart().length
        const startOffset = (lineOffsets[index] ?? 0) + offset + indent
        open = {
          line: index + 1,
          column: offset + indent + 1,
          endLine: index + 1,
          startOffset,
          endOffset: startOffset,
          parts: [],
          contentRanges: [],
        }
      }
      open.endLine = index + 1
      appendPart(rest, (lineOffsets[index] ?? 0) + offset)
    }
  })
  close()

  return sentences
}
