import type { Dictionary, DictionaryEntry } from "../../dictionary/schema.ts"
import type { TaggedToken, Tagger } from "../tagger.ts"
import type { Violation } from "../types.ts"

interface WordToken {
  readonly text: string
  readonly lower: string
  readonly offset: number
}

interface Form {
  readonly entry: DictionaryEntry
  readonly words: readonly string[]
}

const tokenize = (line: string): readonly WordToken[] =>
  Array.from(line.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu), (match) => ({
    text: match[0],
    lower: match[0].toLowerCase(),
    offset: match.index,
  }))

const compileForms = (dictionary: Dictionary): readonly Form[] =>
  dictionary.entries
    .flatMap((entry) =>
      entry.unapproved.map((form) => ({ entry, words: form.toLowerCase().split(/\s+/) })),
    )
    .sort((left, right) => right.words.length - left.words.length)

const hasWords = (
  line: string,
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
    return (
      previous !== undefined &&
      /^\s+$/.test(line.slice(previous.offset + previous.text.length, token.offset))
    )
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

  lines.forEach((line, lineIndex) => {
    const tokens = tokenize(line)
    let taggedTokens: readonly TaggedToken[] | undefined

    for (let index = 0; index < tokens.length; index++) {
      const first = tokens[index]
      if (first === undefined) {
        continue
      }
      const candidates = forms.filter((form) => hasWords(line, tokens, index, form.words))
      const match = candidates.find((form) => {
        if (form.entry.partsOfSpeech === undefined) {
          return true
        }
        if (tagger === undefined) {
          return false
        }
        taggedTokens ??= tagger(line)
        return hasPartOfSpeech(form.entry, first, taggedTokens)
      })
      if (match === undefined) {
        continue
      }

      const last = tokens[index + match.words.length - 1]
      if (last === undefined) {
        continue
      }
      const found = line.slice(first.offset, last.offset + last.text.length)
      violations.push({
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: messageFor(match.entry.suggestions, found),
        suggestions: match.entry.suggestions,
        line: lineIndex + 1,
        column: first.offset + 1,
      })
      index += match.words.length - 1
    }
  })

  return violations
}
