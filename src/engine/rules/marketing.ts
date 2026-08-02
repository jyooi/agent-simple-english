import type { Dictionary } from "../../dictionary/schema.ts"
import { TOKEN_RUN_PATTERN } from "../tokens.ts"
import type { Violation } from "../types.ts"

interface MarketingToken {
  readonly text: string
  readonly key: string
  readonly offset: number
}

interface MarketingForm {
  readonly words: readonly string[]
}

interface CompiledMarketingData {
  readonly formsByFirstWord: ReadonlyMap<string, readonly MarketingForm[]>
  readonly componentWords: ReadonlySet<string>
}

interface MarketingMatch {
  readonly found: string
  readonly offset: number
  readonly tokenCount: number
}

const compiledDataByDictionary = new WeakMap<Dictionary, CompiledMarketingData>()

const caseFoldKey = (text: string): string =>
  text.toLowerCase().toUpperCase().toLowerCase()

const tokenize = (line: string): readonly MarketingToken[] =>
  Array.from(line.matchAll(TOKEN_RUN_PATTERN), (match) => ({
    text: match[0],
    key: caseFoldKey(match[0]),
    offset: match.index,
  }))

const compileMarketingData = (dictionary: Dictionary): CompiledMarketingData => {
  const forms = dictionary.entries
    .flatMap((entry) => entry.unapproved)
    .map((form) => ({ words: form.split(/[\t ]+/u).map(caseFoldKey) }))
    .sort((left, right) => right.words.length - left.words.length)
  const formsByFirstWord = new Map<string, MarketingForm[]>()
  const componentWords = new Set<string>()

  for (const form of forms) {
    const firstWord = form.words[0]
    if (firstWord === undefined) continue

    const candidates = formsByFirstWord.get(firstWord)
    if (candidates === undefined) {
      formsByFirstWord.set(firstWord, [form])
    } else {
      candidates.push(form)
    }
    if (form.words.length === 1) componentWords.add(firstWord)
  }

  return { formsByFirstWord, componentWords }
}

const marketingDataFor = (dictionary: Dictionary): CompiledMarketingData => {
  const cached = compiledDataByDictionary.get(dictionary)
  if (cached !== undefined) return cached

  const compiled = compileMarketingData(dictionary)
  compiledDataByDictionary.set(dictionary, compiled)
  return compiled
}

function matchesForm(
  line: string,
  tokens: readonly MarketingToken[],
  start: number,
  form: MarketingForm,
): boolean {
  return form.words.every((word, wordIndex) => {
    const token = tokens[start + wordIndex]
    if (token === undefined || token.key !== word) return false
    if (wordIndex === 0) return true

    const previous = tokens[start + wordIndex - 1]
    if (previous === undefined) return false
    return /^[\t ]+$/u.test(line.slice(previous.offset + previous.text.length, token.offset))
  })
}

function findCompleteForm(
  line: string,
  tokens: readonly MarketingToken[],
  start: number,
  data: CompiledMarketingData,
): MarketingMatch | undefined {
  const first = tokens[start]
  if (first === undefined) return undefined

  for (const form of data.formsByFirstWord.get(first.key) ?? []) {
    if (!matchesForm(line, tokens, start, form)) continue

    const last = tokens[start + form.words.length - 1]
    if (last === undefined) continue
    return {
      found: line.slice(first.offset, last.offset + last.text.length).toLowerCase(),
      offset: first.offset,
      tokenCount: form.words.length,
    }
  }
}

function findMarketingComponent(
  token: MarketingToken,
  componentWords: ReadonlySet<string>,
): MarketingMatch | undefined {
  let partOffset = 0
  for (const part of token.text.split(/[-‐‑]/u)) {
    if (componentWords.has(caseFoldKey(part))) {
      return { found: part.toLowerCase(), offset: token.offset + partOffset, tokenCount: 1 }
    }
    partOffset += part.length + 1
  }
}

export function marketing(lines: readonly string[], dictionary: Dictionary): Violation[] {
  const data = marketingDataFor(dictionary)
  const violations: Violation[] = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (line === undefined) continue

    const tokens = tokenize(line)
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex]
      if (token === undefined) continue

      const match =
        findCompleteForm(line, tokens, tokenIndex, data) ??
        findMarketingComponent(token, data.componentWords)
      if (match === undefined) continue

      violations.push({
        ruleId: "marketing",
        severity: "soft",
        message: `Do not use marketing language. Delete "${match.found}".`,
        line: lineIndex + 1,
        column: match.offset + 1,
      })
      tokenIndex += match.tokenCount - 1
    }
  }

  return violations
}
