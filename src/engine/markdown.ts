import { parse, postprocess, preprocess } from "micromark"
import type { Extension } from "micromark-util-types"
import { markdownSyntaxExtension } from "./markdown-syntax.ts"

interface MarkdownAnalysis {
  readonly lines: string[]
  readonly structuralLines: string[]
  readonly dictionaryLines: string[]
  readonly structuralBlanks: boolean[]
}

export interface MarkdownCodeResult {
  readonly lines: string[]
  readonly structuralLines: string[]
  readonly structuralBlanks: boolean[]
}

interface AnalysisState {
  readonly source: string
  readonly parseLines: readonly string[]
  readonly sourceLineStarts: readonly number[]
  readonly lineAtOffset: Int32Array
  readonly proseMask: Uint8Array
  readonly structuralMask: Uint8Array
  readonly dictionaryMask: Uint8Array
  readonly containerMask: Uint8Array
  readonly structuralBlanks: boolean[]
}

interface SourceRange {
  readonly start: number
  readonly end: number
}

const parserInput = (source: string): { readonly source: string; readonly offset: number } => ({
  source,
  offset: source.charCodeAt(0) === 0xfeff ? 1 : 0,
})

const translateParserOffsets = <Events extends ReturnType<typeof postprocess>>(
  events: Events,
  offset: number,
): Events => {
  if (offset === 0) return events

  const points = new Set<object>()
  for (const [, token] of events) {
    for (const point of [token.start, token.end]) {
      if (points.has(point)) continue
      points.add(point)
      point.offset += offset
    }
  }
  return events
}

const markdownEvents = (source: string) => {
  const input = parserInput(source)
  const events = postprocess(
    parse({ extensions: [markdownSyntaxExtension] })
      .document()
      .write(preprocess()(input.source, undefined, true)),
  )
  return translateParserOffsets(events, input.offset)
}

const markdownTextEvents = (source: string) => {
  const input = parserInput(source)
  const events = postprocess(
    parse({ extensions: [markdownSyntaxExtension] })
      .text()
      .write(preprocess()(input.source, undefined, true)),
  )
  return translateParserOffsets(events, input.offset)
}

const htmlSyntaxExtension: Extension = {
  disable: {
    null: [
      "attention",
      "autolink",
      "characterEscape",
      "codeText",
      "hardBreakEscape",
      "labelEnd",
      "labelStartImage",
      "labelStartLink",
    ],
  },
}

const htmlSyntaxEvents = (source: string) =>
  postprocess(
    parse({ extensions: [htmlSyntaxExtension] })
      .text()
      .write(preprocess()(source, undefined, true)),
  )

type MarkdownEvents = ReturnType<typeof markdownEvents>
type MarkdownToken = MarkdownEvents[number][1]

const CODE_BLOCK_TOKENS = new Set(["codeFenced", "codeIndented"])
const CONTAINER_TOKENS = new Set(["blockQuotePrefix", "listItemIndent", "listItemPrefix"])
const DICTIONARY_TOKENS = new Set([
  "atxHeadingSequence",
  "autolink",
  "characterReference",
  "emphasisSequence",
  "escapeMarker",
  "hardBreakEscape",
  "hardBreakTrailing",
  "htmlText",
  "labelEnd",
  "labelImage",
  "labelImageMarker",
  "labelLink",
  "labelMarker",
  "reference",
  "resource",
  "setextHeadingLine",
  "strongSequence",
  "thematicBreak",
])
const HTML_SYNTAX_TOKENS = new Set(["characterReference", "htmlText"])

const markRange = (mask: Uint8Array, start: number, end: number): void => {
  mask.fill(1, Math.max(0, start), Math.min(mask.length, end))
}

const createAnalysisState = (source: string, parseLines: readonly string[]): AnalysisState => {
  const sourceLineStarts: number[] = []
  const lineAtOffset = new Int32Array(source.length + 1)
  let offset = 0

  for (let lineIndex = 0; lineIndex < parseLines.length; lineIndex++) {
    sourceLineStarts.push(offset)
    const end = offset + (parseLines[lineIndex]?.length ?? 0)
    lineAtOffset.fill(lineIndex, offset, Math.min(end + 1, lineAtOffset.length))
    offset = end + 1
  }

  return {
    source,
    parseLines,
    sourceLineStarts,
    lineAtOffset,
    proseMask: new Uint8Array(source.length),
    structuralMask: new Uint8Array(source.length),
    dictionaryMask: new Uint8Array(source.length),
    containerMask: new Uint8Array(source.length),
    structuralBlanks: parseLines.map((line) => line.trim() === ""),
  }
}

const markContainerOnlyLinesAsBlank = (state: AnalysisState): void => {
  for (let line = 0; line < state.parseLines.length; line++) {
    const start = state.sourceLineStarts[line] ?? 0
    const end = start + (state.parseLines[line]?.length ?? 0)
    let hasContainer = false
    let hasOtherContent = false

    for (let offset = start; offset < end; offset++) {
      if (state.containerMask[offset] !== 0) {
        hasContainer = true
      } else if (state.source[offset]?.trim() !== "") {
        hasOtherContent = true
        break
      }
    }

    if (hasContainer && !hasOtherContent) state.structuralBlanks[line] = true
  }
}

const markCode = (state: AnalysisState, token: MarkdownToken, block: boolean): void => {
  markRange(state.proseMask, token.start.offset, token.end.offset)
  markRange(state.structuralMask, token.start.offset, token.end.offset)
  markRange(state.dictionaryMask, token.start.offset, token.end.offset)
  if (!block || token.end.offset <= token.start.offset) return

  const firstLine = state.lineAtOffset[Math.min(token.start.offset, state.source.length)] ?? 0
  const lastOffset = Math.max(token.start.offset, token.end.offset - 1)
  const lastLine = state.lineAtOffset[Math.min(lastOffset, state.source.length)] ?? firstLine
  for (let line = firstLine; line <= lastLine; line++) state.structuralBlanks[line] = true
}

const definitionMaskEnds = (events: MarkdownEvents): ReadonlyMap<number, number> => {
  const contentColumns = new Map<number, number>()
  for (const [phase, token] of events) {
    if (phase === "enter" && CONTAINER_TOKENS.has(token.type)) {
      contentColumns.set(
        token.start.line,
        Math.max(contentColumns.get(token.start.line) ?? 1, token.end.column),
      )
    }
  }

  const ends = new Map<number, number>()
  let definition: MarkdownToken | undefined
  let definitionContentColumn = 1

  for (const [phase, token] of events) {
    if (phase === "enter" && token.type === "definition") {
      definition = token
      definitionContentColumn = contentColumns.get(token.start.line) ?? 1
    } else if (
      phase === "enter" &&
      token.type === "definitionTitle" &&
      definition !== undefined &&
      token.start.line > definition.start.line &&
      token.start.column <=
        Math.max(definitionContentColumn, contentColumns.get(token.start.line) ?? 1)
    ) {
      ends.set(definition.start.offset, token.start.offset)
    } else if (phase === "exit" && token.type === "definition") {
      definition = undefined
    }
  }

  return ends
}

const enteredRanges = (
  events: MarkdownEvents,
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

const markHtmlFlows = (state: AnalysisState, htmlFlows: readonly SourceRange[]): void => {
  for (const flow of htmlFlows) {
    const syntax = enteredRanges(
      htmlSyntaxEvents(state.source.slice(flow.start, flow.end)),
      HTML_SYNTAX_TOKENS,
    )
    for (const range of syntax) {
      markRange(state.dictionaryMask, flow.start + range.start, flow.start + range.end)
    }
  }
}

const analyzeEvents = (state: AnalysisState, includeDictionary: boolean): void => {
  const events = markdownEvents(state.source)
  const definitionEnds = includeDictionary ? definitionMaskEnds(events) : new Map<number, number>()
  const htmlFlows: SourceRange[] = []

  for (const [phase, token] of events) {
    if (phase !== "enter") continue

    if (CODE_BLOCK_TOKENS.has(token.type)) {
      markCode(state, token, true)
      continue
    }
    if (token.type === "codeText") {
      markCode(state, token, false)
      continue
    }
    if (CONTAINER_TOKENS.has(token.type)) {
      markRange(state.proseMask, token.start.offset, token.end.offset)
      markRange(state.containerMask, token.start.offset, token.end.offset)
      if (includeDictionary) {
        markRange(state.dictionaryMask, token.start.offset, token.end.offset)
      }
      continue
    }
    if (!includeDictionary) continue

    if (token.type === "definition") {
      markRange(
        state.dictionaryMask,
        token.start.offset,
        definitionEnds.get(token.start.offset) ?? token.end.offset,
      )
    } else if (token.type === "htmlRawFlow") {
      markRange(state.dictionaryMask, token.start.offset, token.end.offset)
    } else if (token.type === "htmlFlow") {
      htmlFlows.push({ start: token.start.offset, end: token.end.offset })
    } else if (DICTIONARY_TOKENS.has(token.type)) {
      markRange(state.dictionaryMask, token.start.offset, token.end.offset)
    }
  }

  markContainerOnlyLinesAsBlank(state)
  if (htmlFlows.length > 0) markHtmlFlows(state, htmlFlows)
}

const applyMask = (
  lines: readonly string[],
  contentStarts: readonly number[],
  parseLines: readonly string[],
  sourceLineStarts: readonly number[],
  mask: Uint8Array,
): string[] =>
  lines.map((line, lineIndex) => {
    const characters = line.split("")
    const contentStart = Math.min(Math.max(contentStarts[lineIndex] ?? 0, 0), line.length)
    const sourceStart = sourceLineStarts[lineIndex] ?? 0
    const parseLine = parseLines[lineIndex] ?? ""

    for (let column = 0; column < parseLine.length; column++) {
      if (mask[sourceStart + column] !== 0) characters[contentStart + column] = " "
    }
    return characters.join("")
  })

const analyzeMarkdown = (
  lines: readonly string[],
  contentStarts: readonly number[] = lines.map(() => 0),
  includeDictionary = true,
): MarkdownAnalysis => {
  if (lines.length === 0) {
    return { lines: [], structuralLines: [], dictionaryLines: [], structuralBlanks: [] }
  }

  const starts = lines.map((line, index) =>
    Math.min(Math.max(contentStarts[index] ?? 0, 0), line.length),
  )
  const parseLines = lines.map((line, index) => line.slice(starts[index]))
  const source = parseLines.join("\n")
  const state = createAnalysisState(source, parseLines)
  analyzeEvents(state, includeDictionary)

  return {
    lines: applyMask(lines, starts, parseLines, state.sourceLineStarts, state.proseMask),
    structuralLines: applyMask(
      lines,
      starts,
      parseLines,
      state.sourceLineStarts,
      state.structuralMask,
    ),
    dictionaryLines: applyMask(
      lines,
      starts,
      parseLines,
      state.sourceLineStarts,
      state.dictionaryMask,
    ),
    structuralBlanks: state.structuralBlanks,
  }
}

export function blankMarkdownForLint(
  inputLines: readonly string[],
  contentStarts: readonly number[],
  includeDictionary: boolean,
): MarkdownAnalysis {
  return analyzeMarkdown(inputLines, contentStarts, includeDictionary)
}

export function blankMarkdownCodeWithStructure(
  inputLines: readonly string[],
  contentStarts: readonly number[] = inputLines.map(() => 0),
): MarkdownCodeResult {
  const analysis = analyzeMarkdown(inputLines, contentStarts, false)
  return {
    lines: analysis.lines,
    structuralLines: analysis.structuralLines,
    structuralBlanks: analysis.structuralBlanks,
  }
}

export function blankMarkdownCode(
  inputLines: readonly string[],
  contentStarts: readonly number[] = inputLines.map(() => 0),
): string[] {
  return analyzeMarkdown(inputLines, contentStarts, false).lines
}

export function maskMarkdownCode(text: string): string {
  return blankMarkdownCode(text.split("\n")).join("\n")
}

export function blankMarkdownDestinations(
  lines: readonly string[],
  contentStarts: readonly number[] = lines.map(() => 0),
): string[] {
  return analyzeMarkdown(lines, contentStarts).dictionaryLines
}

export function blankInlineCode(lines: readonly string[]): string[] {
  const source = lines.join("\n")
  const mask = new Uint8Array(source.length)

  for (const [phase, token] of markdownTextEvents(source)) {
    if (phase === "enter" && token.type === "codeText") {
      markRange(mask, token.start.offset, token.end.offset)
    }
  }

  let offset = 0
  return lines.map((line) => {
    const characters = line.split("")
    for (let index = 0; index < line.length; index++) {
      if (mask[offset + index] !== 0) characters[index] = " "
    }
    offset += line.length + 1
    return characters.join("")
  })
}

export function proseVisibility(text: string): Uint8Array {
  const visibility = new Uint8Array(text.length)
  const sourceLines = text.split("\n")
  const proseLines = blankMarkdownCode(sourceLines)
  let offset = 0

  for (let index = 0; index < sourceLines.length; index++) {
    const line = sourceLines[index] ?? ""
    if (line === proseLines[index]) visibility.fill(1, offset, offset + line.length)
    offset += line.length
    if (offset < text.length) {
      visibility[offset] = 1
      offset++
    }
  }

  return visibility
}
