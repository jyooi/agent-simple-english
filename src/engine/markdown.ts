import { parser as htmlParser } from "@lezer/html"
import { parser as commonMarkParser } from "@lezer/markdown"
import { parse, postprocess, preprocess } from "micromark"
import { frontmatter } from "micromark-extension-frontmatter"
import { gfmTable } from "micromark-extension-gfm-table"
import { normalizeIdentifier } from "micromark-util-normalize-identifier"
import { markdownSyntaxExtension } from "./markdown-syntax.ts"
import { lineOffsets } from "./scan.ts"

interface MarkdownAnalysis {
  readonly lines: string[]
  readonly structuralLines: string[]
  readonly dictionaryLines: string[]
  readonly wordingLines: string[]
  readonly wordingStructuralLines: string[]
  readonly wordingDictionaryLines: string[]
  readonly structuralBlanks: boolean[]
  readonly wordingStructuralBlanks: boolean[]
  readonly sentenceBoundaryLines: boolean[]
  readonly blocks: BlockStructure
}

// Per line: the id of the leaf block that owns it, or -1 when no block does, and
// the column where the block content starts after any quote or list prefix.
export interface BlockStructure {
  readonly ids: readonly number[]
  readonly contentStarts: readonly number[]
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
  readonly blockQuoteMask: Uint8Array | undefined
  readonly blockQuoteLines: Uint8Array | undefined
  readonly structuralBlanks: boolean[]
  readonly sentenceBoundaryLines: boolean[]
  readonly blockIds: number[]
  readonly blockContentStarts: number[]
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

const MARKDOWN_EXTENSIONS = [markdownSyntaxExtension, frontmatter(), gfmTable()]

const markdownEvents = (source: string) => {
  const input = parserInput(source)
  const events = postprocess(
    parse({ extensions: MARKDOWN_EXTENSIONS })
      .document()
      .write(preprocess()(input.source, undefined, true)),
  )
  return translateParserOffsets(events, input.offset)
}

type MarkdownEvents = ReturnType<typeof markdownEvents>
type MarkdownToken = MarkdownEvents[number][1]

export interface MarkdownHtmlComment {
  readonly line: number
  readonly startColumn: number
  readonly endColumn: number
  readonly text: string
}

export const markdownHtmlComments = (source: string): readonly MarkdownHtmlComment[] => {
  const comments: MarkdownHtmlComment[] = []
  const seen = new Set<string>()
  const lineStarts = lineOffsets(source.split("\n"))

  const lineIndexAt = (offset: number): number => {
    let low = 0
    let high = lineStarts.length
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2)
      if ((lineStarts[middle] ?? 0) <= offset) low = middle
      else high = middle
    }
    return low
  }

  const events = markdownEvents(source)
  for (const [phase, token] of events) {
    if (phase !== "enter" || (token.type !== "htmlFlow" && token.type !== "htmlText")) {
      continue
    }

    const tokenText = source.slice(token.start.offset, token.end.offset)
    htmlParser.parse(tokenText).iterate({
      enter(ref) {
        if (ref.name !== "Comment") return

        const start = token.start.offset + ref.from
        const end = token.start.offset + ref.to
        const lineIndex = lineIndexAt(start)
        if (lineIndexAt(Math.max(start, end - 1)) !== lineIndex) return

        const lineStart = lineStarts[lineIndex] ?? 0
        const key = `${start}:${end}`
        if (seen.has(key)) return
        seen.add(key)
        comments.push({
          line: lineIndex + 1,
          startColumn: start - lineStart,
          endColumn: end - lineStart,
          text: source.slice(start, end),
        })
      },
    })
  }

  return comments
}

const NON_PROSE_BLOCK_TOKENS = new Set(["codeFenced", "codeIndented", "table", "yaml"])
const SENTENCE_BOUNDARY_TOKENS = new Set([
  "atxHeading",
  "codeFenced",
  "codeIndented",
  "definition",
  "htmlFlow",
  "htmlRawFlow",
  "paragraph",
  "setextHeading",
  "thematicBreak",
])
const CONTAINER_TOKENS = new Set(["blockQuotePrefix", "listItemIndent", "listItemPrefix"])
// One leaf block per line group. Every rule reads block structure from these ids,
// so no rule needs its own Markdown classifier.
const LEAF_BLOCK_TOKENS = new Set([
  "atxHeading",
  "codeFenced",
  "codeIndented",
  "definition",
  "htmlFlow",
  "htmlRawFlow",
  "paragraph",
  "setextHeadingLine",
  "setextHeadingText",
  "table",
  "thematicBreak",
  "yaml",
])
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
const codeOnlyInlineParser = commonMarkParser.configure({ remove: ["Image", "Link"] })

const HTML_SYNTAX_NODES = new Set(["Comment", "Entity", "HTMLTag", "ProcessingInstruction"])
const HTML_FLOW_NODES = new Set([
  "CloseTag",
  "Comment",
  "DoctypeDecl",
  "EntityReference",
  "MismatchedCloseTag",
  "OpenTag",
  "ProcessingInst",
])
const INLINE_CONTENT_TOKENS = new Set(["atxHeadingText", "paragraph", "setextHeadingText"])
const LINK_SYNTAX_NODES = new Set(["LinkMark", "URL", "LinkTitle"])

const markRange = (mask: Uint8Array, start: number, end: number): void => {
  mask.fill(1, Math.max(0, start), Math.min(mask.length, end))
}

const createAnalysisState = (
  source: string,
  parseLines: readonly string[],
  exemptBlockQuotes: boolean,
): AnalysisState => {
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
    blockQuoteMask: exemptBlockQuotes ? new Uint8Array(source.length) : undefined,
    blockQuoteLines: exemptBlockQuotes ? new Uint8Array(parseLines.length) : undefined,
    structuralBlanks: parseLines.map((line) => line.trim() === ""),
    sentenceBoundaryLines: parseLines.map(() => false),
    blockIds: parseLines.map(() => -1),
    blockContentStarts: parseLines.map(() => 0),
  }
}

const markLeafBlock = (state: AnalysisState, token: MarkdownToken, blockId: number): void => {
  const lastLine = Math.min(token.end.line - 1, state.parseLines.length - 1)
  for (let line = token.start.line - 1; line <= lastLine; line++) {
    state.blockIds[line] = blockId
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

const markBlockQuote = (state: AnalysisState, token: MarkdownToken): void => {
  if (state.blockQuoteMask === undefined || state.blockQuoteLines === undefined) return

  markRange(state.blockQuoteMask, token.start.offset, token.end.offset)
  const firstLine = state.lineAtOffset[Math.min(token.start.offset, state.source.length)] ?? 0
  const lastOffset = Math.max(token.start.offset, token.end.offset - 1)
  const lastLine = state.lineAtOffset[Math.min(lastOffset, state.source.length)] ?? firstLine
  state.blockQuoteLines.fill(1, firstLine, lastLine + 1)
}

const markNonProseBlock = (state: AnalysisState, token: MarkdownToken): void => {
  markRange(state.proseMask, token.start.offset, token.end.offset)
  markRange(state.structuralMask, token.start.offset, token.end.offset)
  markRange(state.dictionaryMask, token.start.offset, token.end.offset)
  if (token.end.offset <= token.start.offset) return

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

const definedLabels = (state: AnalysisState, events: MarkdownEvents): ReadonlySet<string> => {
  const labels = new Set<string>()
  for (const [phase, token] of events) {
    if (phase === "enter" && token.type === "definitionLabelString") {
      labels.add(normalizeIdentifier(state.source.slice(token.start.offset, token.end.offset)))
    }
  }
  return labels
}

interface InlineElement {
  readonly type: number
  readonly from: number
  readonly to: number
  readonly children?: readonly InlineElement[]
}

const inlineElementName = (element: InlineElement): string =>
  commonMarkParser.nodeSet.types[element.type]?.name ?? ""

const markInlineSyntax = (
  state: AnalysisState,
  events: MarkdownEvents,
  includeDictionary: boolean,
): void => {
  const definitions = includeDictionary ? definedLabels(state, events) : new Set<string>()

  for (const [phase, token] of events) {
    if (phase !== "enter" || !INLINE_CONTENT_TOKENS.has(token.type)) continue

    const inlineSource = state.source.slice(token.start.offset, token.end.offset)
    const parser =
      inlineSource.includes(")") || (includeDictionary && definitions.size > 0)
        ? commonMarkParser
        : codeOnlyInlineParser
    const elements = parser.parseInline(
      inlineSource,
      token.start.offset,
    ) as readonly InlineElement[]
    const pending = [...elements]

    while (pending.length > 0) {
      const element = pending.pop()
      if (element === undefined) continue
      if (element.children !== undefined) pending.push(...element.children)

      const name = inlineElementName(element)
      if (name === "InlineCode") {
        markRange(state.proseMask, element.from, element.to)
        markRange(state.structuralMask, element.from, element.to)
        markRange(state.dictionaryMask, element.from, element.to)
        continue
      }
      if (!includeDictionary || (name !== "Link" && name !== "Image")) continue

      const children = element.children ?? []
      let openingEnd: number | undefined
      let closingStart: number | undefined
      let reference: InlineElement | undefined
      let resource = false

      for (const child of children) {
        const childName = inlineElementName(child)
        if (childName === "LinkMark") {
          const syntax = state.source.slice(child.from, child.to)
          if (openingEnd === undefined) openingEnd = child.to
          else if (closingStart === undefined) closingStart = child.from
          if (syntax === "(") resource = true
        } else if (childName === "LinkLabel") {
          reference = child
        }
      }

      if (!resource && definitions.size === 0) continue
      if (
        !resource &&
        reference === undefined &&
        (openingEnd === undefined || closingStart === undefined || closingStart - openingEnd > 999)
      ) {
        continue
      }

      const primary =
        openingEnd === undefined || closingStart === undefined
          ? ""
          : state.source.slice(openingEnd, closingStart)
      const referenceLabel =
        reference === undefined
          ? primary
          : state.source.slice(reference.from + 1, reference.to - 1) || primary
      if (!resource && !definitions.has(normalizeIdentifier(referenceLabel))) continue

      for (const child of children) {
        const childName = inlineElementName(child)
        if (LINK_SYNTAX_NODES.has(childName) || childName === "LinkLabel") {
          markRange(state.dictionaryMask, child.from, child.to)
        }
      }
    }
  }
}

const markHtmlFlows = (state: AnalysisState, htmlFlows: readonly SourceRange[]): void => {
  for (const flow of htmlFlows) {
    const pending = commonMarkParser.parseInline(
      state.source.slice(flow.start, flow.end),
      flow.start,
    ) as readonly InlineElement[]

    for (const element of pending) {
      if (HTML_SYNTAX_NODES.has(inlineElementName(element))) {
        markRange(state.dictionaryMask, element.from, element.to)
      }
    }

    htmlParser.parse(state.source.slice(flow.start, flow.end)).iterate({
      enter(ref) {
        if (HTML_FLOW_NODES.has(ref.name)) {
          markRange(state.dictionaryMask, flow.start + ref.from, flow.start + ref.to)
        }
      },
    })
  }
}

const analyzeEvents = (state: AnalysisState, includeDictionary: boolean): void => {
  const events = markdownEvents(state.source)
  const definitionEnds = includeDictionary ? definitionMaskEnds(events) : new Map<number, number>()
  const htmlFlows: SourceRange[] = []
  let blockQuoteDepth = 0
  let nextBlockId = 0

  for (const [phase, token] of events) {
    if (token.type === "blockQuote" && state.blockQuoteMask !== undefined) {
      if (phase === "enter") {
        if (blockQuoteDepth === 0) markBlockQuote(state, token)
        blockQuoteDepth++
      } else {
        blockQuoteDepth--
      }
    }
    if (phase !== "enter") continue

    if (SENTENCE_BOUNDARY_TOKENS.has(token.type)) {
      state.sentenceBoundaryLines[token.start.line - 1] = true
    }
    if (LEAF_BLOCK_TOKENS.has(token.type)) {
      markLeafBlock(state, token, nextBlockId++)
    }
    if (NON_PROSE_BLOCK_TOKENS.has(token.type)) {
      markNonProseBlock(state, token)
      continue
    }
    if (CONTAINER_TOKENS.has(token.type)) {
      const line = token.start.line - 1
      state.blockContentStarts[line] = Math.max(
        state.blockContentStarts[line] ?? 0,
        token.end.column - 1,
      )
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

  markInlineSyntax(state, events, includeDictionary)
  markContainerOnlyLinesAsBlank(state)
  if (htmlFlows.length > 0) markHtmlFlows(state, htmlFlows)
}

const applyMask = (
  lines: readonly string[],
  contentStarts: readonly number[],
  parseLines: readonly string[],
  sourceLineStarts: readonly number[],
  mask: Uint8Array,
  additionalMask?: Uint8Array,
): string[] =>
  lines.map((line, lineIndex) => {
    const characters = line.split("")
    const contentStart = Math.min(Math.max(contentStarts[lineIndex] ?? 0, 0), line.length)
    const sourceStart = sourceLineStarts[lineIndex] ?? 0
    const parseLine = parseLines[lineIndex] ?? ""

    for (let column = 0; column < parseLine.length; column++) {
      if (
        mask[sourceStart + column] !== 0 ||
        (additionalMask !== undefined && additionalMask[sourceStart + column] !== 0)
      ) {
        characters[contentStart + column] = " "
      }
    }
    return characters.join("")
  })

const analyzeMarkdown = (
  lines: readonly string[],
  contentStarts: readonly number[] = lines.map(() => 0),
  includeDictionary = true,
  exemptBlockQuotes = false,
): MarkdownAnalysis => {
  if (lines.length === 0) {
    return {
      lines: [],
      structuralLines: [],
      dictionaryLines: [],
      wordingLines: [],
      wordingStructuralLines: [],
      wordingDictionaryLines: [],
      structuralBlanks: [],
      wordingStructuralBlanks: [],
      sentenceBoundaryLines: [],
      blocks: { ids: [], contentStarts: [] },
    }
  }

  const starts = lines.map((line, index) =>
    Math.min(Math.max(contentStarts[index] ?? 0, 0), line.length),
  )
  const parseLines = lines.map((line, index) => line.slice(starts[index]))
  const source = parseLines.join("\n")
  const state = createAnalysisState(source, parseLines, exemptBlockQuotes)
  analyzeEvents(state, includeDictionary)

  const proseLines = applyMask(lines, starts, parseLines, state.sourceLineStarts, state.proseMask)
  const structuralLines = applyMask(
    lines,
    starts,
    parseLines,
    state.sourceLineStarts,
    state.structuralMask,
  )
  const dictionaryLines = applyMask(
    lines,
    starts,
    parseLines,
    state.sourceLineStarts,
    state.dictionaryMask,
  )
  const wordingMask = state.blockQuoteMask

  return {
    lines: proseLines,
    structuralLines,
    dictionaryLines,
    wordingLines:
      wordingMask === undefined
        ? proseLines
        : applyMask(
            lines,
            starts,
            parseLines,
            state.sourceLineStarts,
            state.proseMask,
            wordingMask,
          ),
    wordingStructuralLines:
      wordingMask === undefined
        ? structuralLines
        : applyMask(
            lines,
            starts,
            parseLines,
            state.sourceLineStarts,
            state.structuralMask,
            wordingMask,
          ),
    wordingDictionaryLines:
      wordingMask === undefined
        ? dictionaryLines
        : applyMask(
            lines,
            starts,
            parseLines,
            state.sourceLineStarts,
            state.dictionaryMask,
            wordingMask,
          ),
    structuralBlanks: state.structuralBlanks,
    wordingStructuralBlanks:
      state.blockQuoteLines === undefined
        ? state.structuralBlanks
        : state.structuralBlanks.map(
            (blank, lineIndex) => blank || state.blockQuoteLines?.[lineIndex] === 1,
          ),
    sentenceBoundaryLines: state.sentenceBoundaryLines,
    blocks: {
      ids: state.blockIds,
      contentStarts: state.blockContentStarts.map(
        (contentStart, index) => (starts[index] ?? 0) + contentStart,
      ),
    },
  }
}

export function blankMarkdownForLint(
  inputLines: readonly string[],
  contentStarts: readonly number[],
  includeDictionary: boolean,
  exemptBlockQuotes = false,
): MarkdownAnalysis {
  return analyzeMarkdown(inputLines, contentStarts, includeDictionary, exemptBlockQuotes)
}
