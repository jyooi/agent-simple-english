export interface Sentence {
  readonly text: string
  readonly line: number
  readonly column: number
}

const SENTENCE_PUNCTUATION = /[.!?]+/g
const CLOSING_DELIMITERS = new Set(["\"", "'", "’", "”", "»", "›", ")", "]", "}", "*", "_", "~", "`"])

function markdownSuffixEnd(text: string, start: number): number | undefined {
  const opening = text[start]
  const closing = opening === "(" ? ")" : "]"
  let depth = 1

  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === "\\") {
      index += 1
    } else if (character === opening) {
      depth += 1
    } else if (character === closing) {
      depth -= 1
      if (depth === 0) return index + 1
    } else if (character === "\r" || character === "\n") {
      return undefined
    }
  }
}

function terminatorEnd(text: string): number | undefined {
  for (const punctuation of text.matchAll(SENTENCE_PUNCTUATION)) {
    let end = punctuation.index + punctuation[0].length
    let closedLinkLabel = false

    while (CLOSING_DELIMITERS.has(text[end] ?? "")) {
      closedLinkLabel ||= text[end] === "]"
      end += 1
    }

    if (closedLinkLabel && (text[end] === "(" || text[end] === "[")) {
      const suffixEnd = markdownSuffixEnd(text, end)
      if (suffixEnd === undefined) continue
      end = suffixEnd
      while (CLOSING_DELIMITERS.has(text[end] ?? "")) end += 1
    }

    if (end === text.length || /\s/.test(text[end] ?? "")) return end
  }
}

// A sentence starts at the first non-whitespace character and ends at
// terminal punctuation and closing delimiters, at a blank line, or at EOF.
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
      const end = terminatorEnd(rest)
      if (end === undefined) {
        open.parts.push(rest.trim())
        break
      }
      open.parts.push(rest.slice(0, end).trim())
      close()
      offset += end
      rest = rest.slice(end)
    }
  })
  close()

  return sentences
}
