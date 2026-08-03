import Markdown from "@tree-sitter-grammars/tree-sitter-markdown"
import { parse, postprocess, preprocess } from "micromark"
import Parser from "tree-sitter"

interface SourceRange {
  readonly start: number
  readonly end: number
}

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

// Micromark is exact for resolved references but has quadratic label resolution on adversarial input.
const MICROMARK_SOURCE_LIMIT = 10_000
const RAW_HTML_FLOW_START = /^ {0,3}<(?:pre|script|style|textarea)(?:[\t\n\r\f >]|$)/iu
const RAW_HTML_FLOW_SELF_CLOSING = /^ {0,3}<(?:pre|script|style|textarea)\b[^>]*\/\s*>/iu

const markdownEvents = (source: string) =>
  postprocess(
    parse()
      .document()
      .write(preprocess()(source, "utf8", true)),
  )

const markdownTextEvents = (source: string) =>
  postprocess(
    parse()
      .text()
      .write(preprocess()(source, "utf8", true)),
  )

const markRange = (mask: Uint8Array, start: number, end: number): void => {
  mask.fill(1, Math.max(0, start), Math.min(mask.length, end))
}

const normalizedIdentifier = (value: string): string =>
  value
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/^ | $/g, "")
    .toLowerCase()
    .toUpperCase()

interface AnalysisState {
  readonly source: string
  readonly parseLines: readonly string[]
  readonly sourceLineStarts: readonly number[]
  readonly lineAtOffset: Int32Array
  readonly proseMask: Uint8Array
  readonly structuralMask: Uint8Array
  readonly dictionaryMask: Uint8Array
  readonly structuralBlanks: boolean[]
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
    structuralBlanks: parseLines.map((line) => line.trim() === ""),
  }
}

const markCode = (state: AnalysisState, start: number, end: number, block: boolean): void => {
  markRange(state.proseMask, start, end)
  markRange(state.structuralMask, start, end)
  markRange(state.dictionaryMask, start, end)
  if (!block || end <= start) return

  const firstLine = state.lineAtOffset[Math.min(start, state.source.length)] ?? 0
  const lastOffset = Math.max(start, end - 1)
  const lastLine = state.lineAtOffset[Math.min(lastOffset, state.source.length)] ?? firstLine
  for (let line = firstLine; line <= lastLine; line++) state.structuralBlanks[line] = true
}

const MICROMARK_DICTIONARY_TOKENS = new Set([
  "atxHeadingSequence",
  "autolink",
  "blockQuotePrefix",
  "characterReference",
  "definition",
  "emphasisSequence",
  "escapeMarker",
  "hardBreakEscape",
  "hardBreakTrailing",
  "htmlText",
  "labelImageMarker",
  "labelMarker",
  "listItemIndent",
  "listItemPrefix",
  "reference",
  "resource",
  "setextHeadingLine",
  "strongSequence",
  "thematicBreak",
])

const MICROMARK_CODE_TOKENS = new Set(["codeFenced", "codeIndented", "codeText"])
const MICROMARK_BLOCK_CODE_TOKENS = new Set(["codeFenced", "codeIndented"])
const MICROMARK_CONTAINER_TOKENS = new Set(["blockQuotePrefix", "listItemIndent", "listItemPrefix"])

const markOrdinaryHtml = (state: AnalysisState, start: number, end: number): void => {
  const flowSource = state.source.slice(start, end)
  for (const [phase, token] of markdownTextEvents(flowSource)) {
    if (phase === "enter" && (token.type === "htmlText" || token.type === "characterReference")) {
      markRange(state.dictionaryMask, start + token.start.offset, start + token.end.offset)
    }
  }
}

const analyzeWithMicromark = (state: AnalysisState): void => {
  const events = markdownEvents(state.source)
  const contentColumns = new Int32Array(state.parseLines.length).fill(1)

  for (const [phase, token] of events) {
    if (phase !== "enter") continue
    if (MICROMARK_CONTAINER_TOKENS.has(token.type)) {
      const lineIndex = token.start.line - 1
      contentColumns[lineIndex] = Math.max(contentColumns[lineIndex] ?? 1, token.end.column)
      markRange(state.proseMask, token.start.offset, token.end.offset)
    }
  }

  const shortenedDefinitions = new Map<number, number>()
  let definitionStart: number | undefined
  let definitionLine = 0
  let definitionContentColumn = 1
  for (const [phase, token] of events) {
    if (phase === "enter" && token.type === "definition") {
      definitionStart = token.start.offset
      definitionLine = token.start.line
      definitionContentColumn = contentColumns[token.start.line - 1] ?? 1
    } else if (
      phase === "enter" &&
      token.type === "definitionTitle" &&
      definitionStart !== undefined &&
      token.start.line > definitionLine &&
      token.start.column <=
        Math.max(definitionContentColumn, contentColumns[token.start.line - 1] ?? 1)
    ) {
      shortenedDefinitions.set(definitionStart, token.start.offset)
    } else if (phase === "exit" && token.type === "definition") {
      definitionStart = undefined
    }
  }

  for (const [phase, token] of events) {
    if (phase !== "enter") continue
    const { start, end } = token
    if (MICROMARK_CODE_TOKENS.has(token.type)) {
      markCode(state, start.offset, end.offset, MICROMARK_BLOCK_CODE_TOKENS.has(token.type))
    } else if (token.type === "definition") {
      markRange(
        state.dictionaryMask,
        start.offset,
        shortenedDefinitions.get(start.offset) ?? end.offset,
      )
    } else if (MICROMARK_DICTIONARY_TOKENS.has(token.type)) {
      markRange(state.dictionaryMask, start.offset, end.offset)
    } else if (token.type === "htmlFlow") {
      const flowSource = state.source.slice(start.offset, end.offset)
      if (RAW_HTML_FLOW_START.test(flowSource) && !RAW_HTML_FLOW_SELF_CLOSING.test(flowSource)) {
        markRange(state.dictionaryMask, start.offset, end.offset)
      } else {
        markOrdinaryHtml(state, start.offset, end.offset)
      }
    }
  }
}

const blockParser = new Parser()
blockParser.setLanguage(Markdown)
const inlineParser = new Parser()
inlineParser.setLanguage(Markdown.inline)

const walk = (
  root: Parser.SyntaxNode,
  visit: (node: Parser.SyntaxNode) => boolean | undefined,
): void => {
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined || visit(node) === false) continue
    const children = node.children
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index]
      if (child !== undefined) pending.push(child)
    }
  }
}

const TREE_CONTAINER_TOKENS = new Set([
  "block_quote_marker",
  "list_marker_dot",
  "list_marker_minus",
  "list_marker_parenthesis",
  "list_marker_plus",
  "list_marker_star",
])
const TREE_CODE_TOKENS = new Set(["fenced_code_block", "indented_code_block"])
const TREE_REFERENCE_TOKENS = new Set([
  "collapsed_reference_link",
  "full_reference_link",
  "shortcut_link",
])
const TREE_AUTOLINK_TOKENS = new Set(["email_autolink", "uri_autolink"])
const TREE_ENTITY_TOKENS = new Set(["entity_reference", "numeric_character_reference"])
const TREE_MARKER_TOKENS = new Set(["emphasis_delimiter", "hard_line_break"])
const TREE_LINK_MARKERS = new Set(["!", "[", "]", "(", ")"])

const contentOfLabel = (source: string, node: Parser.SyntaxNode): string => {
  const value = source.slice(node.startIndex, node.endIndex)
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value
}

const visibleReferenceLabel = (source: string, node: Parser.SyntaxNode): string => {
  const explicit = node.children.find((child) => child.type === "link_label")
  if (explicit !== undefined && explicit.endIndex - explicit.startIndex > 2) {
    return contentOfLabel(source, explicit)
  }
  const visible = node.children.find(
    (child) => child.type === "link_text" || child.type === "image_description",
  )
  return visible === undefined ? "" : source.slice(visible.startIndex, visible.endIndex)
}

const markTreeLink = (
  state: AnalysisState,
  source: string,
  node: Parser.SyntaxNode,
  base: number,
  definedIdentifiers: ReadonlySet<string>,
): void => {
  const reference = TREE_REFERENCE_TOKENS.has(node.type) || node.type === "image"
  const hasResource = node.children.some(
    (child) => child.type === "link_destination" || child.type === "link_title",
  )
  const hasReferenceLabel = node.children.some((child) => child.type === "link_label")
  const resolved =
    hasResource ||
    ((reference || hasReferenceLabel) &&
      definedIdentifiers.has(normalizedIdentifier(visibleReferenceLabel(source, node))))

  if (!resolved) return

  for (const child of node.children) {
    const start = base + child.startIndex
    const end = base + child.endIndex
    if (
      child.type === "link_destination" ||
      child.type === "link_title" ||
      child.type === "link_label"
    ) {
      markRange(state.dictionaryMask, start, end)
    } else if (TREE_LINK_MARKERS.has(child.type)) {
      markRange(state.dictionaryMask, start, end)
    }
  }
}

const maxNestedImages = (root: Parser.SyntaxNode): number => {
  const pending = [{ node: root, depth: 0 }]
  let maximum = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    const depth = current.depth + (current.node.type === "image" ? 1 : 0)
    maximum = Math.max(maximum, depth)
    for (const child of current.node.children) pending.push({ node: child, depth })
  }
  return maximum
}

// Tree-sitter bounds image nesting, so micromark validates omitted suffixes in affected ranges.
const markRecoveredResources = (
  state: AnalysisState,
  source: string,
  base: number,
  shortcutStarts: ReadonlyMap<number, number>,
  nestedImages: number,
): void => {
  const chunks: string[] = []
  const sourceStarts = new Map<number, { labelStart?: number; resourceStart: number }>()
  const candidates = [...source.matchAll(/\]\((?:[^()\\\n]|\\.)*\)/g)]
  let syntheticOffset = 0
  for (const candidate of candidates) {
    if (candidate.index === undefined) continue
    const resourceStart = candidate.index + 1
    const shortcutStart = shortcutStarts.get(resourceStart)
    if (shortcutStart === undefined && (nestedImages <= 1 || candidates.length < 2)) {
      continue
    }
    const resource = candidate[0].slice(1)
    sourceStarts.set(syntheticOffset + 3, {
      labelStart: shortcutStart === undefined ? undefined : base + shortcutStart,
      resourceStart: base + resourceStart,
    })
    chunks.push(`[x]${resource}\n\n`)
    syntheticOffset += resource.length + 5
  }
  if (chunks.length === 0) return

  for (const [phase, token] of markdownEvents(chunks.join(""))) {
    if (phase !== "enter" || token.type !== "resource") continue
    const recovered = sourceStarts.get(token.start.offset)
    if (recovered !== undefined) {
      markRange(
        state.dictionaryMask,
        recovered.resourceStart,
        recovered.resourceStart + token.end.offset - token.start.offset,
      )
      if (recovered.labelStart !== undefined) {
        markRange(state.dictionaryMask, recovered.labelStart, recovered.labelStart + 1)
        markRange(state.dictionaryMask, recovered.resourceStart - 1, recovered.resourceStart)
      }
    }
  }
}

// Micromark fills the HTML constructs that Tree-sitter deliberately leaves as plain text.
const markRecoveredHtml = (state: AnalysisState, source: string, base: number): void => {
  const chunks: string[] = []
  const sourceRanges = new Map<number, SourceRange>()
  let syntheticOffset = 0
  for (const candidate of source.matchAll(/<[^>\n]*>/g)) {
    if (candidate.index === undefined) continue
    sourceRanges.set(syntheticOffset, {
      start: base + candidate.index,
      end: base + candidate.index + candidate[0].length,
    })
    chunks.push(`${candidate[0]}\n\n`)
    syntheticOffset += candidate[0].length + 2
  }
  if (chunks.length === 0) return

  for (const [phase, token] of markdownTextEvents(chunks.join(""))) {
    if (phase !== "enter" || token.type !== "htmlText") continue
    const sourceRange = sourceRanges.get(token.start.offset)
    if (
      sourceRange !== undefined &&
      token.end.offset - token.start.offset === sourceRange.end - sourceRange.start
    ) {
      markRange(state.dictionaryMask, sourceRange.start, sourceRange.end)
    }
  }
}

const markInlineTree = (
  state: AnalysisState,
  source: string,
  base: number,
  definedIdentifiers: ReadonlySet<string>,
): void => {
  const tree = inlineParser.parse(source, undefined, { bufferSize: source.length + 1 })
  const shortcutStarts = new Map<number, number>()
  walk(tree.rootNode, (node) => {
    const start = base + node.startIndex
    const end = base + node.endIndex
    if (node.type === "shortcut_link") shortcutStarts.set(node.endIndex, node.startIndex)
    if (node.type === "code_span") {
      markCode(state, start, end, false)
      return false
    }
    if (
      node.type === "inline_link" ||
      node.type === "image" ||
      TREE_REFERENCE_TOKENS.has(node.type)
    ) {
      markTreeLink(state, source, node, base, definedIdentifiers)
    }
    if (
      TREE_AUTOLINK_TOKENS.has(node.type) ||
      TREE_ENTITY_TOKENS.has(node.type) ||
      node.type === "html_tag" ||
      node.type === "link_destination" ||
      node.type === "link_title"
    ) {
      markRange(state.dictionaryMask, start, end)
      return false
    }
    if (TREE_MARKER_TOKENS.has(node.type)) {
      markRange(state.dictionaryMask, start, end)
    } else if (node.type === "backslash_escape") {
      markRange(state.dictionaryMask, start, Math.min(start + 1, end))
    }
  })
  markRecoveredResources(state, source, base, shortcutStarts, maxNestedImages(tree.rootNode))
  markRecoveredHtml(state, source, base)
}

const markHtmlTree = (state: AnalysisState, source: string, base: number): void => {
  const tree = inlineParser.parse(source, undefined, { bufferSize: source.length + 1 })
  walk(tree.rootNode, (node) => {
    if (node.type === "html_tag" || TREE_ENTITY_TOKENS.has(node.type)) {
      markRange(state.dictionaryMask, base + node.startIndex, base + node.endIndex)
      return false
    }
  })
  markRecoveredHtml(state, source, base)
}

const analyzeCodeWithTreeSitter = (state: AnalysisState): void => {
  const tree = blockParser.parse(state.source, undefined, {
    bufferSize: state.source.length + 1,
  })
  const inlineRanges: SourceRange[] = []

  walk(tree.rootNode, (node) => {
    if (TREE_CODE_TOKENS.has(node.type)) {
      markCode(state, node.startIndex, node.endIndex, true)
      return false
    }
    if (TREE_CONTAINER_TOKENS.has(node.type)) {
      markRange(state.proseMask, node.startIndex, node.endIndex)
    } else if (node.type === "inline") {
      inlineRanges.push({ start: node.startIndex, end: node.endIndex })
      return false
    }
  })

  for (const range of inlineRanges) {
    const source = state.source.slice(range.start, range.end)
    if (!source.includes("`")) continue
    const inlineTree = inlineParser.parse(source, undefined, { bufferSize: source.length + 1 })
    walk(inlineTree.rootNode, (node) => {
      if (node.type === "code_span") {
        markCode(state, range.start + node.startIndex, range.start + node.endIndex, false)
        return false
      }
    })
  }
}

const virtualColumn = (line: string, sourceColumn: number): number => {
  let column = 0
  for (let index = 0; index < sourceColumn; index++) {
    column = line[index] === "\t" ? column + 4 - (column % 4) : column + 1
  }
  return column
}

const analyzeWithTreeSitter = (state: AnalysisState): void => {
  // Disable Tree-sitter's task-marker ambiguity without changing any source offsets.
  const blockSource = state.source.replace(/^([ \t]{0,3})\[x\](?=:)/gimu, "$1[a]")
  const tree = blockParser.parse(blockSource, undefined, {
    bufferSize: blockSource.length + 1,
  })
  const definitions = new Set<string>()
  const inlineRanges: SourceRange[] = []
  const ordinaryHtmlRanges: SourceRange[] = []
  const contentColumns = new Int32Array(state.parseLines.length)

  walk(tree.rootNode, (node) => {
    if (TREE_CODE_TOKENS.has(node.type)) {
      markCode(state, node.startIndex, node.endIndex, true)
      return false
    }
    if (TREE_CONTAINER_TOKENS.has(node.type)) {
      const line = node.endPosition.row
      const column = virtualColumn(state.parseLines[line] ?? "", node.endPosition.column)
      contentColumns[line] = Math.max(contentColumns[line] ?? 0, column)
      markRange(state.proseMask, node.startIndex, node.endIndex)
      markRange(state.dictionaryMask, node.startIndex, node.endIndex)
    } else if (node.type === "link_reference_definition") {
      const label = node.children.find((child) => child.type === "link_label")
      if (label !== undefined) {
        definitions.add(normalizedIdentifier(contentOfLabel(state.source, label)))
      }
      const title = node.children.find((child) => child.type === "link_title")
      const maskEnd =
        title !== undefined &&
        title.startPosition.row > node.startPosition.row &&
        virtualColumn(
          state.parseLines[title.startPosition.row] ?? "",
          title.startPosition.column,
        ) <=
          Math.max(
            contentColumns[node.startPosition.row] ?? 0,
            contentColumns[title.startPosition.row] ?? 0,
          )
          ? title.startIndex
          : node.endIndex
      markRange(state.dictionaryMask, node.startIndex, maskEnd)
      return false
    } else if (node.type === "inline") {
      inlineRanges.push({ start: node.startIndex, end: node.endIndex })
      return false
    } else if (node.type === "html_block") {
      const html = state.source.slice(node.startIndex, node.endIndex)
      if (RAW_HTML_FLOW_START.test(html) && !RAW_HTML_FLOW_SELF_CLOSING.test(html)) {
        markRange(state.dictionaryMask, node.startIndex, node.endIndex)
      } else {
        ordinaryHtmlRanges.push({ start: node.startIndex, end: node.endIndex })
      }
      return false
    } else if (node.type === "thematic_break" || /^atx_h[1-6]_marker$/.test(node.type)) {
      markRange(state.dictionaryMask, node.startIndex, node.endIndex)
    }
  })

  for (const range of inlineRanges) {
    markInlineTree(state, state.source.slice(range.start, range.end), range.start, definitions)
  }
  for (const range of ordinaryHtmlRanges) {
    markHtmlTree(state, state.source.slice(range.start, range.end), range.start)
  }
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

  if (source.length <= MICROMARK_SOURCE_LIMIT) analyzeWithMicromark(state)
  else if (includeDictionary) analyzeWithTreeSitter(state)
  else analyzeCodeWithTreeSitter(state)

  const analysis = {
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
  return analysis
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
