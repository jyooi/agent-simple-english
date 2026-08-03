import { parser as markdownParser } from "@lezer/markdown"

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
  readonly structuralBlanks: boolean[]
}

type MarkdownTree = ReturnType<typeof markdownParser.parse>
type MarkdownNode = MarkdownTree["topNode"]

interface ParserElement {
  readonly type: number
  readonly from: number
  readonly to: number
  readonly children: readonly ParserElement[]
}

const nodeId = (name: string): number =>
  markdownParser.nodeSet.types.find((type) => type.name === name)?.id ?? -1

const NODE = {
  autolink: nodeId("Autolink"),
  codeBlock: nodeId("CodeBlock"),
  comment: nodeId("Comment"),
  emphasisMark: nodeId("EmphasisMark"),
  entity: nodeId("Entity"),
  escape: nodeId("Escape"),
  fencedCode: nodeId("FencedCode"),
  hardBreak: nodeId("HardBreak"),
  headerMark: nodeId("HeaderMark"),
  horizontalRule: nodeId("HorizontalRule"),
  htmlBlock: nodeId("HTMLBlock"),
  htmlTag: nodeId("HTMLTag"),
  image: nodeId("Image"),
  inlineCode: nodeId("InlineCode"),
  link: nodeId("Link"),
  linkLabel: nodeId("LinkLabel"),
  linkMark: nodeId("LinkMark"),
  linkReference: nodeId("LinkReference"),
  linkTitle: nodeId("LinkTitle"),
  listMark: nodeId("ListMark"),
  processingInstruction: nodeId("ProcessingInstruction"),
  quoteMark: nodeId("QuoteMark"),
  url: nodeId("URL"),
} as const

const markRange = (mask: Uint8Array, start: number, end: number): void => {
  mask.fill(1, Math.max(0, start), Math.min(mask.length, end))
}

const normalizedIdentifier = (value: string): string =>
  value
    .replace(/[\t\n\r ]+/g, " ")
    .replace(/^ | $/g, "")
    .toLowerCase()
    .toUpperCase()

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

const walkTree = (root: MarkdownNode, visit: (node: MarkdownNode) => boolean | undefined): void => {
  const cursor = root.cursor()
  for (;;) {
    const descend = visit(cursor.node) !== false
    if (descend && cursor.firstChild()) continue
    while (!cursor.nextSibling()) {
      if (!cursor.parent()) return
    }
  }
}

const directChildren = (node: MarkdownNode): readonly MarkdownNode[] => {
  const children: MarkdownNode[] = []
  for (let child = node.firstChild; child !== null; child = child.nextSibling) children.push(child)
  return children
}

const labelIdentifier = (source: string, start: number, end: number): string | undefined => {
  if (end - start > 999) return undefined
  return normalizedIdentifier(source.slice(start, end))
}

const referenceIdentifier = (
  source: string,
  children: readonly MarkdownNode[],
): string | undefined => {
  const explicit = children.find((child) => child.type.id === NODE.linkLabel)
  if (explicit !== undefined && explicit.to - explicit.from > 2) {
    return labelIdentifier(source, explicit.from + 1, explicit.to - 1)
  }

  const marks = children.filter((child) => child.type.id === NODE.linkMark)
  const opening = marks[0]
  const closing = marks[1]
  if (opening === undefined || closing === undefined) return undefined
  return labelIdentifier(source, opening.to, closing.from)
}

const virtualColumn = (line: string, sourceColumn: number): number => {
  let column = 0
  for (let index = 0; index < sourceColumn; index++) {
    column = line[index] === "\t" ? column + 4 - (column % 4) : column + 1
  }
  return column
}

const sourceColumn = (state: AnalysisState, offset: number): number => {
  const line = state.lineAtOffset[Math.min(offset, state.source.length)] ?? 0
  return virtualColumn(
    state.parseLines[line] ?? "",
    offset - (state.sourceLineStarts[line] ?? 0),
  )
}

const definitionMaskEnd = (state: AnalysisState, node: MarkdownNode): number => {
  const title = directChildren(node).find((child) => child.type.id === NODE.linkTitle)
  if (title === undefined) return node.to

  const definitionLine = state.lineAtOffset[Math.min(node.from, state.source.length)] ?? 0
  const titleLine = state.lineAtOffset[Math.min(title.from, state.source.length)] ?? definitionLine
  if (titleLine > definitionLine && sourceColumn(state, title.from) <= sourceColumn(state, node.from)) {
    return title.from
  }
  return node.to
}

const markLink = (
  state: AnalysisState,
  node: MarkdownNode,
  definitions: ReadonlySet<string>,
): void => {
  const children = directChildren(node)
  const marks = children.filter((child) => child.type.id === NODE.linkMark)
  const hasResource =
    children.some((child) => child.type.id === NODE.url || child.type.id === NODE.linkTitle) ||
    marks.length >= 4
  const identifier = hasResource ? undefined : referenceIdentifier(state.source, children)
  if (!hasResource && (identifier === undefined || !definitions.has(identifier))) return

  for (const child of children) {
    if (
      child.type.id === NODE.linkMark ||
      child.type.id === NODE.linkLabel ||
      child.type.id === NODE.url ||
      child.type.id === NODE.linkTitle
    ) {
      markRange(state.dictionaryMask, child.from, child.to)
    }
  }
}

const rawContentTag = (tag: string): boolean => {
  const lower = tag.toLowerCase()
  for (const name of ["pre", "script", "style", "textarea"]) {
    if (!lower.startsWith(`<${name}`)) continue
    const boundary = lower[name.length + 1]
    if (boundary === undefined || boundary === ">" || boundary === "/" || /\s/u.test(boundary)) {
      return true
    }
  }
  return false
}

const selfClosingTag = (tag: string): boolean => {
  let index = tag.length - 2
  while (index >= 0 && /\s/u.test(tag[index] ?? "")) index--
  return tag[index] === "/"
}

const htmlElements = (source: string, start: number, end: number): readonly ParserElement[] =>
  markdownParser.parseInline(source.slice(start, end), start) as readonly ParserElement[]

const markHtmlBlock = (state: AnalysisState, start: number, end: number): void => {
  const pending = [...htmlElements(state.source, start, end)]
  const syntax: ParserElement[] = []
  let firstTag: ParserElement | undefined

  while (pending.length > 0) {
    const element = pending.pop()
    if (element === undefined) continue
    if (element.type === NODE.htmlTag && (firstTag === undefined || element.from < firstTag.from)) {
      firstTag = element
    }
    if (
      element.type === NODE.htmlTag ||
      element.type === NODE.entity ||
      element.type === NODE.comment ||
      element.type === NODE.processingInstruction
    ) {
      syntax.push(element)
    }
    for (const child of element.children) pending.push(child)
  }

  if (firstTag !== undefined) {
    const tag = state.source.slice(firstTag.from, firstTag.to)
    if (firstTag.from === start && rawContentTag(tag) && !selfClosingTag(tag)) {
      markRange(state.dictionaryMask, start, end)
      return
    }
  }

  for (const element of syntax) markRange(state.dictionaryMask, element.from, element.to)
}

const collectDefinitions = (source: string, root: MarkdownNode): ReadonlySet<string> => {
  const definitions = new Set<string>()
  walkTree(root, (node) => {
    if (node.type.id !== NODE.linkReference) return
    const label = directChildren(node).find((child) => child.type.id === NODE.linkLabel)
    if (label !== undefined) {
      const identifier = labelIdentifier(source, label.from + 1, label.to - 1)
      if (identifier !== undefined) definitions.add(identifier)
    }
    return false
  })
  return definitions
}

const CODE_BLOCKS = new Set([NODE.codeBlock, NODE.fencedCode])
const CONTAINER_MARKS = new Set([NODE.quoteMark, NODE.listMark])
const DICTIONARY_NODES = new Set([
  NODE.autolink,
  NODE.comment,
  NODE.entity,
  NODE.htmlTag,
  NODE.processingInstruction,
  NODE.hardBreak,
  NODE.headerMark,
  NODE.horizontalRule,
  NODE.emphasisMark,
])

const analyzeTree = (state: AnalysisState, includeDictionary: boolean): void => {
  const tree = markdownParser.parse(state.source)
  const definitions = includeDictionary
    ? collectDefinitions(state.source, tree.topNode)
    : new Set<string>()

  walkTree(tree.topNode, (node) => {
    if (CODE_BLOCKS.has(node.type.id)) {
      markCode(state, node.from, node.to, true)
      return false
    }
    if (node.type.id === NODE.inlineCode) {
      markCode(state, node.from, node.to, false)
      return false
    }
    if (CONTAINER_MARKS.has(node.type.id)) {
      const siblingStart = node.nextSibling?.from ?? node.to
      const end =
        siblingStart > node.to && state.source.slice(node.to, siblingStart).trim() === ""
          ? siblingStart
          : node.to
      markRange(state.proseMask, node.from, end)
      if (includeDictionary) markRange(state.dictionaryMask, node.from, end)
      return
    }
    if (!includeDictionary) return

    if (node.type.id === NODE.linkReference) {
      markRange(state.dictionaryMask, node.from, definitionMaskEnd(state, node))
      return false
    }
    if (node.type.id === NODE.link || node.type.id === NODE.image) {
      markLink(state, node, definitions)
      return
    }
    if (node.type.id === NODE.htmlBlock) {
      markHtmlBlock(state, node.from, node.to)
      return false
    }
    if (node.type.id === NODE.escape) {
      markRange(state.dictionaryMask, node.from, Math.min(node.from + 1, node.to))
      return false
    }
    if (DICTIONARY_NODES.has(node.type.id)) {
      markRange(state.dictionaryMask, node.from, node.to)
      return false
    }
  })
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
  analyzeTree(state, includeDictionary)

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
  const pending = [...(markdownParser.parseInline(source, 0) as readonly ParserElement[])]
  while (pending.length > 0) {
    const element = pending.pop()
    if (element === undefined) continue
    if (element.type === NODE.inlineCode) {
      markRange(mask, element.from, element.to)
    } else {
      for (const child of element.children) pending.push(child)
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
