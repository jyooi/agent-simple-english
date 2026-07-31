interface MarkdownContext {
  readonly contentStart: number
  readonly quoteDepth: number
}

interface ActiveParagraph {
  readonly quoteDepth: number
}

interface ActiveFence {
  readonly marker: "`" | "~"
  readonly length: number
  readonly quoteDepth: number
  readonly listIndent: number
}

interface ListContent {
  readonly content: string
  readonly indent: number
}

const ATX_HEADING = /^ {0,3}#{1,6}(?:[\t ]+|$)/
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[\t ]*\r?$/
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:_[\t ]*){3,}|(?:-[\t ]*){3,})\r?$/
const LIST_MARKER = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([\t ]+|$)/
const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})(.*)\r?$/

const markdownContext = (
  line: string,
  maximumDepth = Number.POSITIVE_INFINITY,
): MarkdownContext => {
  let contentStart = 0
  let quoteDepth = 0

  while (contentStart < line.length && quoteDepth < maximumDepth) {
    let marker = contentStart
    let spaces = 0
    while (spaces < 4 && line[marker] === " ") {
      marker++
      spaces++
    }
    if (spaces > 3 || line[marker] !== ">") {
      break
    }
    contentStart = marker + 1
    if (line[contentStart] === " " || line[contentStart] === "\t") {
      contentStart++
    }
    quoteDepth++
  }

  return { contentStart, quoteDepth }
}

const listContent = (content: string): ListContent => {
  let contentStart = 0

  while (true) {
    const match = content.slice(contentStart).match(LIST_MARKER)
    if (match === null) {
      break
    }
    const whitespace = match[2] ?? ""
    const consumedWhitespace = whitespace.length > 4 ? 1 : whitespace.length
    contentStart += match[0].length - whitespace.length + consumedWhitespace
  }

  return { content: content.slice(contentStart), indent: contentStart }
}

const isBlank = (content: string): boolean => /^[\t ]*\r?$/.test(content)
const isIndentedCode = (content: string): boolean => /^(?: {4}|\t)/.test(content)
const startsNewBlock = (content: string): boolean =>
  ATX_HEADING.test(content) ||
  LIST_MARKER.test(content) ||
  SETEXT_UNDERLINE.test(content) ||
  THEMATIC_BREAK.test(content)
const startsParagraph = (content: string): boolean =>
  !ATX_HEADING.test(content) && !SETEXT_UNDERLINE.test(content) && !THEMATIC_BREAK.test(content)
const blank = (line: string): string => line.replace(/[^\r]/g, " ")

const fenceOpener = (content: string): Pick<ActiveFence, "marker" | "length"> | undefined => {
  const match = content.match(FENCE_OPENER)
  const delimiter = match?.[1]
  const info = match?.[2] ?? ""
  if (delimiter === undefined || (delimiter[0] === "`" && info.includes("`"))) {
    return undefined
  }
  const marker = delimiter[0]
  if (marker !== "`" && marker !== "~") {
    return undefined
  }
  return { marker, length: delimiter.length }
}

const isFenceCloser = (content: string, fence: ActiveFence): boolean => {
  const match = content.match(/^ {0,3}(`+|~+)[\t ]*\r?$/)
  const delimiter = match?.[1]
  return delimiter?.[0] === fence.marker && delimiter.length >= fence.length
}

const fenceContainerContent = (line: string, fence: ActiveFence): string | undefined => {
  const context = markdownContext(line, fence.quoteDepth)
  if (context.quoteDepth !== fence.quoteDepth) {
    return isBlank(line) ? "" : undefined
  }
  const content = line.slice(context.contentStart)
  if (fence.listIndent === 0 || isBlank(content)) {
    return content
  }
  if (!content.startsWith(" ".repeat(fence.listIndent))) {
    return undefined
  }
  return content.slice(fence.listIndent)
}

export function blankMarkdownCode(text: string): string[] {
  let activeFence: ActiveFence | undefined
  let inIndentedCode = false
  let activeParagraph: ActiveParagraph | undefined

  return text.split("\n").map((line) => {
    if (activeFence !== undefined) {
      const content = fenceContainerContent(line, activeFence)
      if (content !== undefined) {
        if (isFenceCloser(content, activeFence)) {
          activeFence = undefined
        }
        return blank(line)
      }
      activeFence = undefined
    }

    const context = markdownContext(line)
    const content = line.slice(context.contentStart)
    const nested = listContent(content)
    const opener = fenceOpener(nested.content)
    if (opener !== undefined) {
      activeFence = {
        ...opener,
        quoteDepth: context.quoteDepth,
        listIndent: nested.indent,
      }
      inIndentedCode = false
      activeParagraph = undefined
      return blank(line)
    }

    if (isBlank(content)) {
      activeParagraph = undefined
      return inIndentedCode ? blank(line) : line
    }

    if (inIndentedCode) {
      if (isIndentedCode(content)) {
        return blank(line)
      }
      inIndentedCode = false
    }

    if (
      activeParagraph !== undefined &&
      context.quoteDepth <= activeParagraph.quoteDepth &&
      !startsNewBlock(content)
    ) {
      return line
    }

    if (isIndentedCode(nested.content)) {
      activeParagraph = undefined
      inIndentedCode = true
      return blank(line)
    }

    activeParagraph = startsParagraph(nested.content)
      ? { quoteDepth: context.quoteDepth }
      : undefined
    return line
  })
}
