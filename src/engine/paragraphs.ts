export interface Paragraph {
  readonly lines: readonly string[]
  readonly line: number
}

const LIST_MARKER = /^(?:[-*+]\s|\d+[.)]\s)/

type LineKind = "blank" | "heading" | "table-row" | "list-item" | "prose"

function classify(line: string): LineKind {
  const trimmed = line.trim()
  if (trimmed === "") return "blank"
  if (trimmed.startsWith("|")) return "table-row"
  if (trimmed.startsWith("#")) return "heading"
  if (LIST_MARKER.test(trimmed)) return "list-item"
  return "prose"
}

// A paragraph is a run of prose lines; a blank line, a heading, and a table
// row all end it. A list item is its own paragraph: STE asks the writer to
// replace a long paragraph with a vertical list, so a rule that counts the
// list as one paragraph would punish the recommended fix.
export function segmentParagraphs(lines: readonly string[]): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let open: { line: number; lines: string[] } | null = null

  const close = () => {
    if (open) {
      paragraphs.push({ lines: open.lines, line: open.line })
      open = null
    }
  }

  lines.forEach((raw, index) => {
    switch (classify(raw)) {
      case "blank":
      case "heading":
      case "table-row":
        close()
        break
      case "list-item":
        close()
        paragraphs.push({ lines: [raw], line: index + 1 })
        break
      case "prose":
        if (!open) {
          open = { line: index + 1, lines: [] }
        }
        open.lines.push(raw)
    }
  })
  close()

  return paragraphs
}
