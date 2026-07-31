import { DICTIONARY_TOKEN_SOURCE } from "../../dictionary/form.ts"
import type { Dictionary, DictionaryEntry } from "../../dictionary/schema.ts"
import type { TaggedToken, Tagger } from "../tagger.ts"
import type { Violation } from "../types.ts"

interface WordToken {
  readonly text: string
  readonly lower: string
  readonly lineIndex: number
  readonly offset: number
}

interface Form {
  readonly entry: DictionaryEntry
  readonly words: readonly string[]
}

interface MarkdownContext {
  readonly contentStart: number
  readonly quoteDepth: number
}

const ATX_HEADING = /^ {0,3}#{1,6}(?:[\t ]+|$)/
const LIST_MARKER = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[\t ]+|$)/
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[\t ]*\r?$/
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:_[\t ]*){3,}|(?:-[\t ]*){3,})\r?$/

const tokenize = (lines: readonly string[]): readonly WordToken[] => {
  const tokenPattern = new RegExp(DICTIONARY_TOKEN_SOURCE, "gu")
  return lines.flatMap((line, lineIndex) =>
    Array.from(line.matchAll(tokenPattern), (match) => ({
      text: match[0],
      lower: match[0].toLowerCase(),
      lineIndex,
      offset: match.index,
    })),
  )
}

const compileForms = (dictionary: Dictionary): readonly Form[] =>
  dictionary.entries
    .flatMap((entry) =>
      entry.unapproved.map((form) => ({ entry, words: form.toLowerCase().split(/\s+/) })),
    )
    .sort((left, right) => right.words.length - left.words.length)

const markdownContext = (line: string): MarkdownContext => {
  let contentStart = 0
  let quoteDepth = 0

  while (contentStart < line.length) {
    let marker = contentStart
    let spaces = 0
    while (spaces < 4 && line[marker] === " ") {
      marker++
      spaces++
    }
    if (spaces > 3 || line[marker] !== ">") {
      break
    }
    contentStart = marker + 1
    if (line[contentStart] === " " || line[contentStart] === "\t") {
      contentStart++
    }
    quoteDepth++
  }

  return { contentStart, quoteDepth }
}

const blockContent = (line: string, context: MarkdownContext): string =>
  line.slice(context.contentStart)

const isLeafBlock = (content: string): boolean => {
  const listMarker = content.match(LIST_MARKER)
  const nestedContent = listMarker === null ? content : content.slice(listMarker[0].length)
  return ATX_HEADING.test(nestedContent)
}

const startsNewBlock = (content: string): boolean =>
  ATX_HEADING.test(content) ||
  LIST_MARKER.test(content) ||
  SETEXT_UNDERLINE.test(content) ||
  THEMATIC_BREAK.test(content)

const isSoftLineBreak = (
  lines: readonly string[],
  previous: WordToken,
  token: WordToken,
): boolean => {
  if (token.lineIndex !== previous.lineIndex + 1) {
    return false
  }
  const previousLine = lines[previous.lineIndex]
  const nextLine = lines[token.lineIndex]
  if (previousLine === undefined || nextLine === undefined) {
    return false
  }

  const previousContext = markdownContext(previousLine)
  const nextContext = markdownContext(nextLine)
  const previousContent = blockContent(previousLine, previousContext)
  const nextContent = blockContent(nextLine, nextContext)
  if (
    previousContext.quoteDepth !== nextContext.quoteDepth ||
    isLeafBlock(previousContent) ||
    startsNewBlock(nextContent)
  ) {
    return false
  }

  const lineEnd = previousLine.endsWith("\r") ? previousLine.length - 1 : previousLine.length
  const trailing = previousLine.slice(previous.offset + previous.text.length, lineEnd)
  const leading = nextLine.slice(nextContext.contentStart, token.offset)
  return (trailing === "" || trailing === " ") && /^[\t ]*$/.test(leading)
}

const hasWords = (
  lines: readonly string[],
  tokens: readonly WordToken[],
  start: number,
  words: readonly string[],
): boolean =>
  words.every((word, index) => {
    const token = tokens[start + index]
    if (token === undefined || token.lower !== word) {
      return false
    }
    if (index === 0) {
      return true
    }
    const previous = tokens[start + index - 1]
    if (previous === undefined) {
      return false
    }
    if (token.lineIndex === previous.lineIndex) {
      const line = lines[token.lineIndex]
      return (
        line !== undefined &&
        /^\s+$/.test(line.slice(previous.offset + previous.text.length, token.offset))
      )
    }
    return isSoftLineBreak(lines, previous, token)
  })

const hasPartOfSpeech = (
  entry: DictionaryEntry,
  token: WordToken,
  taggedTokens: readonly TaggedToken[] | undefined,
): boolean => {
  if (entry.partsOfSpeech === undefined) {
    return true
  }
  return (
    taggedTokens?.some(
      (tagged) =>
        tagged.offset === token.offset && entry.partsOfSpeech?.includes(tagged.pos) === true,
    ) === true
  )
}

const messageFor = (suggestions: readonly string[], found: string): string => {
  const alternatives = suggestions.map((suggestion) => `"${suggestion}"`).join(" or ")
  return `Use ${alternatives}, not "${found}".`
}

export function dictionaryRule(
  lines: readonly string[],
  dictionary: Dictionary,
  tagger?: Tagger,
): Violation[] {
  const forms = compileForms(dictionary)
  const violations: Violation[] = []
  const tokens = tokenize(lines)
  const taggedTokensByLine = new Map<number, readonly TaggedToken[]>()

  for (let index = 0; index < tokens.length; index++) {
    const first = tokens[index]
    if (first === undefined) {
      continue
    }
    const candidates = forms.filter((form) => hasWords(lines, tokens, index, form.words))
    const match = candidates.find((form) => {
      if (form.entry.partsOfSpeech === undefined) {
        return true
      }
      if (tagger === undefined) {
        return false
      }
      let taggedTokens = taggedTokensByLine.get(first.lineIndex)
      if (taggedTokens === undefined) {
        const line = lines[first.lineIndex]
        if (line === undefined) {
          return false
        }
        taggedTokens = tagger(line)
        taggedTokensByLine.set(first.lineIndex, taggedTokens)
      }
      return hasPartOfSpeech(form.entry, first, taggedTokens)
    })
    if (match === undefined) {
      continue
    }

    const last = tokens[index + match.words.length - 1]
    if (last === undefined) {
      continue
    }
    const found =
      first.lineIndex === last.lineIndex
        ? lines[first.lineIndex]?.slice(first.offset, last.offset + last.text.length)
        : tokens
            .slice(index, index + match.words.length)
            .map((token) => token.text)
            .join(" ")
    if (found === undefined) {
      continue
    }
    violations.push({
      ruleId: "dictionary-not-approved-word",
      severity: "hard",
      message: messageFor(match.entry.suggestions, found),
      suggestions: match.entry.suggestions,
      line: first.lineIndex + 1,
      column: first.offset + 1,
    })
    index += match.words.length - 1
  }

  return violations
}
