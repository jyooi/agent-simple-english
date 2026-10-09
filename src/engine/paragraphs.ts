import { type BlockStructure, NO_LEAF_BLOCK } from "./markdown.ts"

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

export function segmentParagraphsByLeafBlock(
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
    const blockId = blocks.leafBlockIdByLine[index] ?? NO_LEAF_BLOCK
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

    const contentStart = blocks.contentStartAfterContainerPrefixByLine[index] ?? 0
    open.lines.push(raw.slice(contentStart))
    open.boundaryLines.push((boundaryLines[index] ?? raw).slice(contentStart))
  })
  close()

  return paragraphs
}
