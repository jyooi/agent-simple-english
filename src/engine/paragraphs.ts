export interface Paragraph {
  readonly lines: readonly string[]
  readonly boundaryLines: readonly string[]
  readonly line: number
  readonly column: number
}

const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/

type LineKind = "blank" | "block-boundary" | "blockquote" | "list-item" | "prose"
type ParagraphKind = "blockquote" | "blockquote-list-item" | "list-item" | "prose"

const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const BLOCKQUOTE = /^ {0,3}>[ \t]?/

function listItemContent(line: string): string | undefined {
  const trimmed = line.trimStart()
  const marker = LIST_MARKER.exec(trimmed)
  return marker ? trimmed.slice(marker[0].length) : undefined
}

function blockquoteContent(line: string): string | undefined {
  const marker = BLOCKQUOTE.exec(line)
  return marker ? line.slice(marker[0].length) : undefined
}

function classify(line: string): LineKind {
  const trimmed = line.trim()
  if (trimmed === "") return "blank"
  if (trimmed.startsWith("|") || ATX_HEADING.test(line)) return "block-boundary"
  if (blockquoteContent(line) !== undefined) return "blockquote"
  if (listItemContent(line) !== undefined) return "list-item"
  return "prose"
}

export function segmentParagraphs(
  lines: readonly string[],
  columns: readonly number[] = lines.map(() => 1),
  boundaryLines: readonly string[] = lines,
): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let open: {
    line: number
    column: number
    lines: string[]
    boundaryLines: string[]
    kind: ParagraphKind
  } | null = null

  const close = () => {
    if (open) {
      paragraphs.push({
        lines: open.lines,
        boundaryLines: open.boundaryLines,
        line: open.line,
        column: open.column,
      })
      open = null
    }
  }

  lines.forEach((raw, index) => {
    const boundaryRaw = boundaryLines[index] ?? raw
    switch (classify(raw)) {
      case "blank":
      case "block-boundary":
        close()
        break
      case "blockquote": {
        const content = blockquoteContent(raw) ?? ""
        const boundaryContent = blockquoteContent(boundaryRaw) ?? ""
        const contentKind = classify(content)
        if (contentKind === "blank" || contentKind === "block-boundary") {
          close()
          break
        }
        if (contentKind === "list-item") {
          close()
          open = {
            line: index + 1,
            column: columns[index] ?? 1,
            lines: [listItemContent(content) ?? ""],
            boundaryLines: [listItemContent(boundaryContent) ?? ""],
            kind: "blockquote-list-item",
          }
          break
        }
        if (open?.kind !== "blockquote" && open?.kind !== "blockquote-list-item") close()
        if (!open) {
          open = {
            line: index + 1,
            column: columns[index] ?? 1,
            lines: [],
            boundaryLines: [],
            kind: "blockquote",
          }
        }
        const inListItem = open.kind === "blockquote-list-item"
        open.lines.push(inListItem ? content.trimStart() : content)
        open.boundaryLines.push(inListItem ? boundaryContent.trimStart() : boundaryContent)
        break
      }
      case "list-item":
        close()
        open = {
          line: index + 1,
          column: columns[index] ?? 1,
          lines: [listItemContent(raw) ?? ""],
          boundaryLines: [listItemContent(boundaryRaw) ?? ""],
          kind: "list-item",
        }
        break
      case "prose": {
        if (!open) {
          open = {
            line: index + 1,
            column: columns[index] ?? 1,
            lines: [],
            boundaryLines: [],
            kind: "prose",
          }
        }
        const inListItem = open.kind === "list-item"
        open.lines.push(inListItem ? raw.trimStart() : raw)
        open.boundaryLines.push(inListItem ? boundaryRaw.trimStart() : boundaryRaw)
        break
      }
    }
  })
  close()

  return paragraphs
}
