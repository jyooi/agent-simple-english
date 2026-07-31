export interface Sentence {
  readonly text: string
  readonly line: number
  readonly column: number
}

const TERMINATOR = /[.!?]+(\s|$)/

// A sentence starts at the first non-whitespace character and ends at
// terminal punctuation followed by whitespace, at a blank line, or at EOF.
// Sentences may span lines; position is where the sentence starts (1-based).
export function segmentSentences(lines: readonly string[]): Sentence[] {
  const sentences: Sentence[] = []
  let open: { line: number; column: number; parts: string[] } | null = null

  const close = () => {
    if (!open) return
    const text = open.parts.join(" ").trim()
    if (text !== "") {
      sentences.push({ text, line: open.line, column: open.column })
    }
    open = null
  }

  lines.forEach((raw, index) => {
    if (raw.trim() === "") {
      close()
      return
    }
    let rest = raw
    let offset = 0
    while (rest.trim() !== "") {
      if (!open) {
        const indent = rest.length - rest.trimStart().length
        open = { line: index + 1, column: offset + indent + 1, parts: [] }
      }
      const terminator = rest.match(TERMINATOR)
      if (terminator?.index === undefined) {
        open.parts.push(rest.trim())
        break
      }
      const end = terminator.index + terminator[0].length
      open.parts.push(rest.slice(0, end).trim())
      close()
      offset += end
      rest = rest.slice(end)
    }
  })
  close()

  return sentences
}
