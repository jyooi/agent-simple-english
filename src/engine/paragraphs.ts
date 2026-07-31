export interface Paragraph {
  readonly lines: readonly string[]
  readonly line: number
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
      case "blockquote": {
        const content = blockquoteContent(raw) ?? ""
        const contentKind = classify(content)
        if (contentKind === "blank" || contentKind === "block-boundary") {
          close()
          break
        }
        if (contentKind === "list-item") {
          close()
          open = {
            line: index + 1,
            lines: [listItemContent(content) ?? ""],
            kind: "blockquote-list-item",
          }
          break
        }
        if (open?.kind !== "blockquote" && open?.kind !== "blockquote-list-item") close()
        if (!open) {
          open = { line: index + 1, lines: [], kind: "blockquote" }
        }
        open.lines.push(open.kind === "blockquote-list-item" ? content.trimStart() : content)
        break
      }
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
