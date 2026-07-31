interface MarkdownContext {
  readonly contentStart: number
  readonly quoteDepth: number
}

interface ActiveParagraph {
  readonly quoteDepth: number
}

const FENCE = /^\s{0,3}(?:```|~~~)/
const ATX_HEADING = /^ {0,3}#{1,6}(?:[\t ]+|$)/
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[\t ]*\r?$/
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:_[\t ]*){3,}|(?:-[\t ]*){3,})\r?$/
const LIST_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[\t ]+|$)/

const markdownContext = (line: string): MarkdownContext => {
  let contentStart = 0
  let quoteDepth = 0

  while (contentStart < line.length) {
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

export function blankMarkdownCode(text: string): string[] {
  let inFence = false
  let inIndentedCode = false
  let activeParagraph: ActiveParagraph | undefined

  return text.split("\n").map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence
      inIndentedCode = false
      activeParagraph = undefined
      return blank(line)
    }
    if (inFence) {
      return blank(line)
    }

    const context = markdownContext(line)
    const content = line.slice(context.contentStart)
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

    if (isIndentedCode(content)) {
      activeParagraph = undefined
      inIndentedCode = true
      return blank(line)
    }

    activeParagraph = startsParagraph(content) ? { quoteDepth: context.quoteDepth } : undefined
    return line
  })
}
