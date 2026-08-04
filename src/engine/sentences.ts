export interface Sentence {
  readonly text: string
  readonly line: number
  readonly column: number
  readonly endLine: number
  readonly startOffset: number
  readonly endOffset: number
  readonly contentRanges: readonly {
    readonly start: number
    readonly end: number
  }[]
}

const QUOTATION_CLOSERS = new Set(['"', "'", "’", "”", "»", "›"])
const OPENING_PROSE_DELIMITERS = new Set(["(", "{"])
const CLOSING_DELIMITERS = new Set([
  ...QUOTATION_CLOSERS,
  ")",
  "]",
  "}",
  "*",
  "_",
  "~",
  "`",
])

function valueAt(values: Int32Array | Uint32Array, index: number): number {
  const value = values[index]
  if (value === undefined) throw new RangeError(`Array index ${index} is out of bounds`)
  return value
}

function sentinelAt(values: Int32Array, index: number): number {
  return values[index] ?? -1
}

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
      case '"':
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
    const parenthesisEnd = valueAt(parentheses, suffixStart)
    const bracketEnd = valueAt(brackets, suffixStart)
    if (text[suffixStart] === "(" && parenthesisEnd >= 0) {
      linkSuffixes[suffixStart] = parenthesisEnd
    } else if (text[suffixStart] === "[" && bracketEnd >= 0) {
      linkSuffixes[suffixStart] = bracketEnd
    }
  }

  return { parentheses, brackets, linkSuffixes }
}

const ABBREVIATIONS = ["e.g.", "i.e.", "etc.", "vs.", "Fig.", "No."] as const
const CAPITALIZED_CONTINUATION_ABBREVIATIONS = new Set(["e.g.", "i.e.", "vs."])
const CODE_DESIGNATOR_ABBREVIATIONS = new Set<ListedAbbreviation>(["Fig.", "No."])
const STANDALONE_INITIAL_CONTEXTS = new Set([
  "appendix",
  "class",
  "figure",
  "item",
  "model",
  "no",
  "option",
  "part",
  "section",
  "select",
  "selected",
  "step",
  "type",
])

type ListedAbbreviation = (typeof ABBREVIATIONS)[number]

function hasUnderscoreEmphasisDelimiters(
  text: string,
  tokenStart: number,
  tokenEnd: number,
): boolean {
  if (text[tokenStart - 1] !== "_" || text[tokenEnd + 1] !== "_") return false

  let openingStart = tokenStart - 1
  while (text[openingStart - 1] === "_") openingStart -= 1
  let closingEnd = tokenEnd + 1
  while (text[closingEnd + 1] === "_") closingEnd += 1

  const openingLength = tokenStart - openingStart
  const closingLength = closingEnd - tokenEnd
  return (
    openingLength === closingLength &&
    openingLength <= 3 &&
    !/[\p{L}\p{N}_]/u.test(text[openingStart - 1] ?? "") &&
    !/[\p{L}\p{N}_]/u.test(text[closingEnd + 1] ?? "")
  )
}

function hasTokenStartBoundary(text: string, tokenStart: number, tokenEnd: number): boolean {
  const previous = text[tokenStart - 1] ?? ""
  return (
    !/[\p{L}\p{N}_.]/u.test(previous) ||
    (previous === "_" && hasUnderscoreEmphasisDelimiters(text, tokenStart, tokenEnd))
  )
}

function listedAbbreviationAtPeriod(
  text: string,
  periodIndex: number,
): { readonly abbreviation: ListedAbbreviation; readonly start: number } | undefined {
  for (const abbreviation of ABBREVIATIONS) {
    const start = periodIndex - abbreviation.length + 1
    if (start < 0 || text.slice(start, periodIndex + 1) !== abbreviation) continue
    if (hasTokenStartBoundary(text, start, periodIndex)) return { abbreviation, start }
  }

  return undefined
}

function capitalInitialStartAtPeriod(text: string, periodIndex: number): number | undefined {
  const initialStart = periodIndex - 1
  const initial = text[initialStart] ?? ""
  return /[A-Z]/u.test(initial) && hasTokenStartBoundary(text, initialStart, periodIndex)
    ? initialStart
    : undefined
}

interface NextContent {
  readonly character: string
  readonly word: string
}

function nextContentIn(
  text: string,
  start: number,
  linkSuffixes: Int32Array,
  brackets: Int32Array,
  suffixCanBeAttached: boolean,
): NextContent | undefined {
  let canSkipAttachedSuffix = suffixCanBeAttached
  for (let index = start; index < text.length; index += 1) {
    const character = text[index] ?? ""
    if (/\s/u.test(character)) {
      canSkipAttachedSuffix = false
      continue
    }
    if (CLOSING_DELIMITERS.has(character)) continue

    const linkSuffixEnd = sentinelAt(linkSuffixes, index)
    if (linkSuffixEnd >= 0) {
      index = linkSuffixEnd - 1
      continue
    }

    const bracketEnd = sentinelAt(brackets, index)
    if (character === "[" && bracketEnd >= 0 && canSkipAttachedSuffix) {
      index = bracketEnd - 1
      continue
    }
    if (character === "[" || OPENING_PROSE_DELIMITERS.has(character)) continue

    return {
      character,
      word: /^[\p{L}\p{N}_-]+/u.exec(text.slice(index))?.[0] ?? character,
    }
  }
  return undefined
}

function nextContent(
  text: string,
  start: number,
  followingText: string | undefined,
  linkSuffixes: Int32Array,
  brackets: Int32Array,
): NextContent | undefined {
  const current = nextContentIn(text, start, linkSuffixes, brackets, true)
  if (current !== undefined || followingText === undefined) return current

  const followingDelimiters = markdownDelimiterEnds(followingText)
  return nextContentIn(
    followingText,
    0,
    followingDelimiters.linkSuffixes,
    followingDelimiters.brackets,
    false,
  )
}

function initialIntroducesName(text: string, initialStart: number): boolean {
  const previousWord = /([\p{L}]+)\s*$/u.exec(text.slice(0, initialStart))?.[1]
  return !STANDALONE_INITIAL_CONTEXTS.has(
    previousWord?.toLocaleLowerCase("en-US") ?? "",
  )
}

function abbreviationIsInternal(
  text: string,
  boundaryText: string,
  periodIndex: number,
  followingBoundaryText: string | undefined,
  linkSuffixes: Int32Array,
  brackets: Int32Array,
): boolean {
  const listed = listedAbbreviationAtPeriod(boundaryText, periodIndex)
  const initialStart = capitalInitialStartAtPeriod(text, periodIndex)
  if (listed === undefined && initialStart === undefined) return false

  const next = nextContent(
    boundaryText,
    periodIndex + 1,
    followingBoundaryText,
    linkSuffixes,
    brackets,
  )
  if (next === undefined || !/[A-Z]/u.test(next.character)) return true
  if (QUOTATION_CLOSERS.has(boundaryText[periodIndex + 1] ?? "")) return false
  if (listed !== undefined) {
    if (CODE_DESIGNATOR_ABBREVIATIONS.has(listed.abbreviation)) {
      return /^[A-Z][A-Z0-9_-]*$/u.test(next.word)
    }
    return CAPITALIZED_CONTINUATION_ABBREVIATIONS.has(listed.abbreviation)
  }
  return initialStart !== undefined && initialIntroducesName(text, initialStart)
}

// Identifier masking blanks dotted abbreviations but leaves their final periods.
// Restore only listed abbreviations from the equal-length pre-identifier line.
function restoreAbbreviations(text: string, boundaryText: string): string {
  const characters = text.split("")
  let changed = false

  for (let index = 0; index < boundaryText.length; index++) {
    if (boundaryText[index] !== "." || text[index] !== ".") continue
    const listed = listedAbbreviationAtPeriod(boundaryText, index)
    if (listed === undefined) continue
    for (let characterIndex = listed.start; characterIndex <= index; characterIndex++) {
      characters[characterIndex] = boundaryText[characterIndex] ?? ""
    }
    changed = true
  }

  return changed ? characters.join("") : text
}

function sentenceTerminatorEnds(
  text: string,
  boundaryText: string,
  followingBoundaryText?: string,
): number[] {
  const { parentheses, brackets, linkSuffixes } = markdownDelimiterEnds(text)
  const closingRuns = new Uint32Array(text.length + 1)
  const closingBracketCounts = new Uint32Array(text.length + 1)
  const referenceRuns = new Int32Array(text.length).fill(-1)
  const ends: number[] = []
  closingRuns[text.length] = text.length

  for (let index = text.length - 1; index >= 0; index -= 1) {
    closingRuns[index] = CLOSING_DELIMITERS.has(text[index] ?? "")
      ? valueAt(closingRuns, index + 1)
      : index
    closingBracketCounts[index] =
      valueAt(closingBracketCounts, index + 1) + (text[index] === "]" ? 1 : 0)
  }

  for (let index = text.length - 1; index >= 0; index -= 1) {
    const bracketEnd = valueAt(brackets, index)
    if (text[index] !== "[" || bracketEnd < 0) continue
    let end = valueAt(closingRuns, bracketEnd)
    const referenceEnd = sentinelAt(referenceRuns, end)
    if (text[end] === "[" && referenceEnd >= 0) end = referenceEnd
    referenceRuns[index] = end
  }

  for (let index = 0; index < text.length; index += 1) {
    const linkSuffixEnd = valueAt(linkSuffixes, index)
    if (linkSuffixEnd >= 0) {
      index = linkSuffixEnd - 1
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
    if (
      punctuationEnd === index + 1 &&
      text[index] === "." &&
      abbreviationIsInternal(
        text,
        boundaryText,
        index,
        followingBoundaryText,
        linkSuffixes,
        brackets,
      )
    ) {
      continue
    }

    let end = valueAt(closingRuns, punctuationEnd)
    const closedLinkLabel =
      valueAt(closingBracketCounts, punctuationEnd) > valueAt(closingBracketCounts, end)

    if (closedLinkLabel && text[end] === "(") {
      const parenthesisEnd = valueAt(parentheses, end)
      if (parenthesisEnd < 0) {
        index = punctuationEnd - 1
        continue
      }
      end = valueAt(closingRuns, parenthesisEnd)
    }

    const referenceEnd = sentinelAt(referenceRuns, end)
    if (text[end] === "[" && referenceEnd >= 0) end = referenceEnd
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
export function segmentSentences(
  lines: readonly string[],
  sourceText: string = lines.join("\n"),
  structuralBlanks: readonly boolean[] = lines.map((line) => line.trim() === ""),
  boundaryLines: readonly string[] = lines,
): Sentence[] {
  const sentences: Sentence[] = []
  const lineOffsets = [0]
  for (let index = 0; index < sourceText.length; index++) {
    if (sourceText[index] === "\n") lineOffsets.push(index + 1)
  }
  let open: {
    line: number
    column: number
    endLine: number
    startOffset: number
    endOffset: number
    parts: string[]
    contentRanges: Array<{ start: number; end: number }>
  } | null = null

  const appendPart = (part: string, startOffset: number) => {
    if (!open) return
    const leadingWhitespace = part.length - part.trimStart().length
    const text = part.trim()
    open.parts.push(text)
    if (text === "") return
    const start = startOffset + leadingWhitespace
    const end = start + text.length
    open.contentRanges.push({ start, end })
    open.endOffset = end
  }

  const close = () => {
    if (!open) return
    const text = open.parts.join(" ").trim()
    if (text !== "") {
      sentences.push({
        text,
        line: open.line,
        column: open.column,
        endLine: open.endLine,
        startOffset: open.startOffset,
        endOffset: open.endOffset,
        contentRanges: open.contentRanges,
      })
    }
    open = null
  }

  lines.forEach((maskedRaw, index) => {
    if (maskedRaw.trim() === "") {
      if (structuralBlanks[index] ?? true) close()
      return
    }
    const boundaryRaw = boundaryLines[index] ?? maskedRaw
    const raw = restoreAbbreviations(maskedRaw, boundaryRaw)
    let followingBoundaryRaw: string | undefined
    for (let followingIndex = index + 1; followingIndex < lines.length; followingIndex++) {
      if (structuralBlanks[followingIndex] ?? true) break
      const candidate = boundaryLines[followingIndex] ?? lines[followingIndex] ?? ""
      if (candidate.trim() !== "") {
        followingBoundaryRaw = candidate
        break
      }
    }
    let offset = 0
    for (const end of sentenceTerminatorEnds(raw, boundaryRaw, followingBoundaryRaw)) {
      const part = raw.slice(offset, end)
      if (!open) {
        const indent = part.length - part.trimStart().length
        const startOffset = (lineOffsets[index] ?? 0) + offset + indent
        open = {
          line: index + 1,
          column: offset + indent + 1,
          endLine: index + 1,
          startOffset,
          endOffset: startOffset,
          parts: [],
          contentRanges: [],
        }
      }
      open.endLine = index + 1
      appendPart(part, (lineOffsets[index] ?? 0) + offset)
      close()
      offset = end
    }

    const rest = raw.slice(offset)
    if (rest.trim() !== "") {
      if (!open) {
        const indent = rest.length - rest.trimStart().length
        const startOffset = (lineOffsets[index] ?? 0) + offset + indent
        open = {
          line: index + 1,
          column: offset + indent + 1,
          endLine: index + 1,
          startOffset,
          endOffset: startOffset,
          parts: [],
          contentRanges: [],
        }
      }
      open.endLine = index + 1
      appendPart(rest, (lineOffsets[index] ?? 0) + offset)
    }
  })
  close()

  return sentences
}
