export interface Paragraph {
  readonly lines: readonly string[]
  readonly line: number
}

const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/

type LineKind = "blank" | "block-boundary" | "list-item" | "prose"
type ParagraphKind = "list-item" | "prose"

const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const BLOCKQUOTE = /^ {0,3}>/

function listItemContent(line: string): string | undefined {
  const trimmed = line.trimStart()
  const marker = LIST_MARKER.exec(trimmed)
  return marker ? trimmed.slice(marker[0].length) : undefined
}

function classify(line: string): LineKind {
  const trimmed = line.trim()
  if (trimmed === "") return "blank"
  if (trimmed.startsWith("|") || ATX_HEADING.test(line) || BLOCKQUOTE.test(line)) {
    return "block-boundary"
  }
  if (listItemContent(line) !== undefined) return "list-item"
  return "prose"
}

export function segmentParagraphs(lines: readonly string[]): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let open: { line: number; lines: string[]; kind: ParagraphKind } | null = null

  const close = () => {
    if (open) {
      paragraphs.push({ lines: open.lines, line: open.line })
      open = null
    }
  }

  lines.forEach((raw, index) => {
    switch (classify(raw)) {
      case "blank":
      case "block-boundary":
        close()
        break
      case "list-item":
        close()
        open = {
          line: index + 1,
          lines: [listItemContent(raw) ?? ""],
          kind: "list-item",
        }
        break
      case "prose": {
        if (!open) {
          open = { line: index + 1, lines: [], kind: "prose" }
        }
        open.lines.push(open.kind === "list-item" ? raw.trimStart() : raw)
        break
      }
    }
  })
  close()

  return paragraphs
}
