import { parser as htmlParser } from "@lezer/html"
import type { ExtractedComments, ProseBreak } from "./comments.ts"
import type { MarkdownHtmlComment } from "./markdown.ts"

// These elements hold code, markup, or preformatted content, never prose.
// `code` is also inline, so a semicolon in inline code stays quiet while the
// sentence around it still reads as one sentence.
const IGNORED_CONTENT_TAGS = new Set(["code", "pre", "script", "style", "textarea"])

// Phrasing elements that wrap words inside one sentence.
// They never start a prose block, so a sentence split across them counts as one sentence.
// Every other element starts a prose block.
// That rule separates a heading, a list item, a table cell, and bare text in a `div`.
const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "img",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
])

/**
 * Find every single-line HTML comment in the document with the lezer parser.
 * The markdown finder cannot see comments that markdown would read as indented code.
 */
export function htmlComments(source: string): readonly MarkdownHtmlComment[] {
  const comments: MarkdownHtmlComment[] = []
  const lineStarts = [0]
  for (let offset = 0; offset < source.length; offset++) {
    if (source.charCodeAt(offset) === 0x0a) lineStarts.push(offset + 1)
  }

  htmlParser.parse(source).iterate({
    enter(ref) {
      if (ref.name !== "Comment") return
      const text = source.slice(ref.from, ref.to)
      if (text.includes("\n")) return

      let lineIndex = lineStarts.length - 1
      while (lineIndex > 0 && (lineStarts[lineIndex] as number) > ref.from) lineIndex -= 1
      const lineStart = lineStarts[lineIndex] as number
      comments.push({
        line: lineIndex + 1,
        startColumn: ref.from - lineStart,
        endColumn: ref.to - lineStart,
        text,
      })
    },
  })

  return comments
}

interface OpenElement {
  readonly tag: string
  readonly inline: boolean
}

/**
 * Keep the text nodes of an HTML document and blank every other byte with a space.
 * Attribute values, comments, entity references, tags, and ignored element content all go.
 * Each prose block becomes one prose break, so sentences never join across a block edge.
 * The masked lines keep the width of the source lines, so positions stay exact.
 */
export function extractHtmlProse(source: string): ExtractedComments {
  const keep = new Uint8Array(source.length)
  const blockEdges: number[] = []
  const open: OpenElement[] = []
  let ignoreDepth = 0

  htmlParser.parse(source).iterate({
    enter(ref) {
      if (ref.name === "Element") {
        const tagName = ref.node.firstChild?.getChild("TagName")
        const tag =
          tagName === null || tagName === undefined
            ? ""
            : source.slice(tagName.from, tagName.to).toLowerCase()
        const inline = INLINE_TAGS.has(tag)
        if (!inline) blockEdges.push(ref.from)
        if (IGNORED_CONTENT_TAGS.has(tag)) ignoreDepth += 1
        open.push({ tag, inline })
        return
      }
      if (ref.name === "Text" && ignoreDepth === 0) keep.fill(1, ref.from, ref.to)
    },
    leave(ref) {
      if (ref.name !== "Element") return
      const element = open.pop()
      if (element === undefined) return
      if (IGNORED_CONTENT_TAGS.has(element.tag)) ignoreDepth -= 1
      if (!element.inline) blockEdges.push(ref.to)
    },
  })

  blockEdges.sort((left, right) => left - right)

  const lines = source.split("\n")
  const contentStarts: number[] = []
  const proseBreaks: ProseBreak[] = []
  let lineStart = 0
  let edgeIndex = 0
  let blockIndex = -1

  const maskedLines = lines.map((line, lineIndex) => {
    const characters = new Array<string>(line.length).fill(" ")
    let contentStart = -1

    for (let column = 0; column < line.length; column += 1) {
      const offset = lineStart + column
      while (edgeIndex < blockEdges.length && (blockEdges[edgeIndex] as number) <= offset) {
        edgeIndex += 1
      }
      if (keep[offset] === 0) continue

      const character = source[offset] as string
      characters[column] = character
      if (/\s/u.test(character)) continue
      if (contentStart === -1) contentStart = column
      if (edgeIndex === blockIndex) continue
      if (blockIndex !== -1) proseBreaks.push({ line: lineIndex, column })
      blockIndex = edgeIndex
    }

    lineStart += line.length + 1
    contentStarts.push(contentStart === -1 ? line.length : contentStart)
    return characters.join("")
  })

  return { lines: maskedLines, contentStarts, proseBreaks, lineComments: [] }
}
