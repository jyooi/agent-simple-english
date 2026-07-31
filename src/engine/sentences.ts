export interface Sentence {
  readonly text: string
  readonly line: number
  readonly column: number
}

const CLOSING_DELIMITERS = new Set(["\"", "'", "’", "”", "»", "›", ")", "]", "}", "*", "_", "~", "`"])

function markdownDelimiterEnds(text: string): {
  readonly parentheses: Int32Array
  readonly brackets: Int32Array
  readonly linkSuffixes: Int32Array
} {
  const parentheses = new Int32Array(text.length).fill(-1)
  const brackets = new Int32Array(text.length).fill(-1)
  const linkSuffixes = new Int32Array(text.length).fill(-1)
  const parenthesisStack: number[] = []
  const bracketStack: number[] = []
  let opaqueDelimiter: string | undefined

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (opaqueDelimiter !== undefined) {
      if (character === "\\") {
        index += 1
      } else if (character === opaqueDelimiter) {
        opaqueDelimiter = undefined
      }
      continue
    }

    switch (character) {
      case "\\":
        index += 1
        break
      case "\"":
      case "'": {
        const opening = parenthesisStack[parenthesisStack.length - 1]
        const isLinkTitle =
          opening !== undefined && text[opening - 1] === "]" && /\s/.test(text[index - 1] ?? "")
        if (isLinkTitle) opaqueDelimiter = character
        break
      }
      case "<": {
        const opening = parenthesisStack[parenthesisStack.length - 1]
        const isAngleDestination =
          opening !== undefined && text[opening - 1] === "]" && index === opening + 1
        if (isAngleDestination) opaqueDelimiter = ">"
        break
      }
      case "(":
        parenthesisStack.push(index)
        break
      case ")": {
        const opening = parenthesisStack.pop()
        if (opening !== undefined) parentheses[opening] = index + 1
        break
      }
      case "[":
        bracketStack.push(index)
        break
      case "]": {
        const opening = bracketStack.pop()
        if (opening !== undefined) brackets[opening] = index + 1
        break
      }
    }
  }

  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] !== "]") continue
    const suffixStart = index + 1
    if (text[suffixStart] === "(" && parentheses[suffixStart] >= 0) {
      linkSuffixes[suffixStart] = parentheses[suffixStart]
    } else if (text[suffixStart] === "[" && brackets[suffixStart] >= 0) {
      linkSuffixes[suffixStart] = brackets[suffixStart]
    }
  }

  return { parentheses, brackets, linkSuffixes }
}

function sentenceTerminatorEnds(text: string): number[] {
  const { parentheses, brackets, linkSuffixes } = markdownDelimiterEnds(text)
  const closingRuns = new Uint32Array(text.length + 1)
  const closingBracketCounts = new Uint32Array(text.length + 1)
  const referenceRuns = new Int32Array(text.length).fill(-1)
  const ends: number[] = []
  closingRuns[text.length] = text.length

  for (let index = text.length - 1; index >= 0; index -= 1) {
    closingRuns[index] = CLOSING_DELIMITERS.has(text[index] ?? "")
      ? closingRuns[index + 1]
      : index
    closingBracketCounts[index] =
      closingBracketCounts[index + 1] + (text[index] === "]" ? 1 : 0)
  }

  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text[index] !== "[" || brackets[index] < 0) continue
    let end = closingRuns[brackets[index]]
    if (text[end] === "[" && referenceRuns[end] >= 0) end = referenceRuns[end]
    referenceRuns[index] = end
  }

  for (let index = 0; index < text.length; index += 1) {
    if (linkSuffixes[index] >= 0) {
      index = linkSuffixes[index] - 1
      continue
    }
    if (text[index] !== "." && text[index] !== "!" && text[index] !== "?") continue

    let punctuationEnd = index + 1
    while (
      text[punctuationEnd] === "." ||
      text[punctuationEnd] === "!" ||
      text[punctuationEnd] === "?"
    ) {
      punctuationEnd += 1
    }

    let end = closingRuns[punctuationEnd]
    const closedLinkLabel =
      closingBracketCounts[punctuationEnd] > closingBracketCounts[end]

    if (closedLinkLabel && text[end] === "(") {
      if (parentheses[end] < 0) {
        index = punctuationEnd - 1
        continue
      }
      end = closingRuns[parentheses[end]]
    }

    if (text[end] === "[" && referenceRuns[end] >= 0) end = referenceRuns[end]
    if (end === text.length || /\s/.test(text[end] ?? "")) {
      ends.push(end)
      index = end - 1
    } else {
      index = punctuationEnd - 1
    }
  }

  return ends
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
    let offset = 0
    for (const end of sentenceTerminatorEnds(raw)) {
      const part = raw.slice(offset, end)
      if (!open) {
        const indent = part.length - part.trimStart().length
        open = { line: index + 1, column: offset + indent + 1, parts: [] }
      }
      open.parts.push(part.trim())
      close()
      offset = end
    }

    const rest = raw.slice(offset)
    if (rest.trim() !== "") {
      if (!open) {
        const indent = rest.length - rest.trimStart().length
        open = { line: index + 1, column: offset + indent + 1, parts: [] }
      }
      open.parts.push(rest.trim())
    }
  })
  close()

  return sentences
}
