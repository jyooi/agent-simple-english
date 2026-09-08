import type { BlockStructure } from "./markdown.ts"

export interface Paragraph {
  readonly lines: readonly string[]
  readonly boundaryLines: readonly string[]
  readonly line: number
  readonly column: number
}

interface OpenParagraph {
  readonly blockId: number
  readonly line: number
  readonly column: number
  readonly lines: string[]
  readonly boundaryLines: string[]
}

// One paragraph per Markdown leaf block. Each line drops the quote and list
// prefix that the block parser found, so a rule reads block content only.
export function segmentParagraphs(
  lines: readonly string[],
  columns: readonly number[],
  boundaryLines: readonly string[],
  blocks: BlockStructure,
): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let open: OpenParagraph | undefined

  const close = () => {
    if (open !== undefined) paragraphs.push(open)
    open = undefined
  }

  lines.forEach((raw, index) => {
    const blockId = blocks.ids[index] ?? -1
    if (blockId < 0) {
      close()
      return
    }
    if (open !== undefined && open.blockId !== blockId) close()
    if (open === undefined) {
      open = {
        blockId,
        line: index + 1,
        column: columns[index] ?? 1,
        lines: [],
        boundaryLines: [],
      }
    }

    const contentStart = blocks.contentStarts[index] ?? 0
    open.lines.push(raw.slice(contentStart))
    open.boundaryLines.push((boundaryLines[index] ?? raw).slice(contentStart))
  })
  close()

  return paragraphs
}
