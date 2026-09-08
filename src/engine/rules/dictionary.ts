import { DICTIONARY_TOKEN_SOURCE } from "../../dictionary/form.ts"
import type { Dictionary, DictionaryData, DictionaryEntry } from "../../dictionary/schema.ts"
import type { BlockStructure } from "../markdown.ts"
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

export type CompiledDictionary =
  | { readonly mode: "approved-words"; readonly approvedWords: ReadonlySet<string> }
  | { readonly mode: "not-approved"; readonly forms: readonly Form[] }

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

export const compileDictionary = (dictionary: DictionaryData): CompiledDictionary =>
  "approvedWords" in dictionary
    ? {
        mode: "approved-words",
        approvedWords: new Set(dictionary.approvedWords.map((word) => word.toLowerCase())),
      }
    : { mode: "not-approved", forms: compileForms(dictionary) }

// Two words join across a line break only inside one Markdown leaf block.
const isSoftLineBreak = (
  lines: readonly string[],
  blocks: BlockStructure,
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

  const previousBlock = blocks.ids[previous.lineIndex] ?? -1
  if (previousBlock < 0 || previousBlock !== blocks.ids[token.lineIndex]) {
    return false
  }

  const lineEnd = previousLine.endsWith("\r") ? previousLine.length - 1 : previousLine.length
  const trailing = previousLine.slice(previous.offset + previous.text.length, lineEnd)
  const leading = nextLine.slice(blocks.contentStarts[token.lineIndex] ?? 0, token.offset)
  return (trailing === "" || trailing === " ") && /^[\t ]*$/.test(leading)
}

const hasWords = (
  lines: readonly string[],
  blocks: BlockStructure,
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
    return isSoftLineBreak(lines, blocks, previous, token)
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

const approvedWordRule = (
  lines: readonly string[],
  approvedWords: ReadonlySet<string>,
): Violation[] =>
  tokenize(lines).flatMap((token) =>
    approvedWords.has(token.lower)
      ? []
      : [
          {
            ruleId: "dictionary-not-approved-word" as const,
            severity: "hard" as const,
            message: `"${token.text}" is not in the approved-word list.`,
            suggestions: [],
            line: token.lineIndex + 1,
            column: token.offset + 1,
          },
        ],
  )

export function dictionaryRule(
  lines: readonly string[],
  dictionary: CompiledDictionary,
  blocks: BlockStructure,
  tagger?: Tagger,
  proseLines: readonly string[] = lines,
): Violation[] {
  if (dictionary.mode === "approved-words") {
    return approvedWordRule(proseLines, dictionary.approvedWords)
  }
  const forms = dictionary.forms
  const violations: Violation[] = []
  const tokens = tokenize(lines)
  const taggedTokensByLine = new Map<number, readonly TaggedToken[]>()

  for (let index = 0; index < tokens.length; index++) {
    const first = tokens[index]
    if (first === undefined) {
      continue
    }
    const candidates = forms.filter((form) => hasWords(lines, blocks, tokens, index, form.words))
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
