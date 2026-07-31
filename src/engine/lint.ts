import type { Dictionary } from "../dictionary/schema.ts"
import { extractHashComments, extractSlashComments, type ProseBreak } from "./comments.ts"
import { blankIdentifiers } from "./identifiers.ts"
import { blankMarkdownCodeWithStructure } from "./markdown.ts"
import { segmentParagraphs } from "./paragraphs.ts"
import { contraction } from "./rules/contraction.ts"
import { dictionaryRule } from "./rules/dictionary.ts"
import { hedging } from "./rules/hedging.ts"
import { marketing } from "./rules/marketing.ts"
import { paragraphLength } from "./rules/paragraph-length.ts"
import { phrasalVerb } from "./rules/phrasal-verb.ts"
import { semicolon } from "./rules/semicolon.ts"
import { sentenceLength } from "./rules/sentence-length.ts"
import { verbForm } from "./rules/verb-form.ts"
import { segmentSentences } from "./sentences.ts"
import type { Tagger } from "./tagger.ts"
import type { LintKind, LintOptions, LintReport, Violation } from "./types.ts"

export const DEFAULT_MAX_SENTENCE_WORDS = 25

interface ResolvedOptions {
  readonly maxSentenceWords: number
  readonly dictionary?: Dictionary
  readonly tagger?: Tagger
}

interface ExtractedProse {
  readonly lines: readonly string[]
  readonly contentStarts: readonly number[]
  readonly proseBreaks: readonly ProseBreak[]
}

const wholeText = (text: string): ExtractedProse => {
  const lines = text.split("\n")
  return { lines, contentStarts: lines.map(() => 0), proseBreaks: [] }
}

const splitProseRuns = (extracted: ExtractedProse): readonly ExtractedProse[] => {
  if (extracted.proseBreaks.length === 0) return [extracted]

  const boundaries: readonly (ProseBreak | undefined)[] = [
    undefined,
    ...extracted.proseBreaks,
    undefined,
  ]
  return boundaries.slice(0, -1).map((start, runIndex) => {
    const end = boundaries[runIndex + 1]
    const lines = extracted.lines.map((line, lineIndex) => {
      if (start !== undefined && lineIndex < start.line) return " ".repeat(line.length)
      if (end !== undefined && lineIndex > end.line) return " ".repeat(line.length)

      const from = start?.line === lineIndex ? Math.min(start.column, line.length) : 0
      const to = end?.line === lineIndex ? Math.min(end.column, line.length) : line.length
      if (from >= to) return " ".repeat(line.length)
      return `${" ".repeat(from)}${line.slice(from, to)}${" ".repeat(line.length - to)}`
    })
    const contentStarts = extracted.contentStarts.map((contentStart, lineIndex) => {
      if (start !== undefined && lineIndex < start.line) return extracted.lines[lineIndex]?.length ?? 0
      if (end !== undefined && lineIndex > end.line) return extracted.lines[lineIndex]?.length ?? 0
      return start?.line === lineIndex ? Math.max(contentStart, start.column) : contentStart
    })
    return { lines, contentStarts, proseBreaks: [] }
  })
}

const extract = (kind: LintKind, text: string, options: LintOptions): ExtractedProse => {
  if (kind === "slash-source") return extractSlashComments(text)
  if (kind === "hash-source") return extractHashComments(text, options.sourceDialect)
  return wholeText(text)
}

const lintProse = (
  lines: readonly string[],
  structuralLines: readonly string[],
  mechanicalLines: readonly string[],
  contentStarts: readonly number[],
  structuralBlanks: readonly boolean[],
  { maxSentenceWords, dictionary, tagger }: ResolvedOptions,
) => [
  ...sentenceLength(segmentSentences(lines, structuralBlanks), maxSentenceWords),
  ...paragraphLength(
    segmentParagraphs(structuralLines.map((line, index) => line.slice(contentStarts[index] ?? 0))),
  ),
  ...contraction(lines),
  ...semicolon(mechanicalLines),
  ...phrasalVerb(lines),
  ...hedging(lines),
  ...marketing(lines),
  ...(dictionary === undefined
    ? []
    : dictionaryRule(structuralLines, dictionary, tagger, contentStarts)),
  ...(tagger === undefined ? [] : verbForm(lines, tagger)),
]

const lintExtracted = (extracted: ExtractedProse, options: ResolvedOptions): Violation[] => {
  const markdown = blankMarkdownCodeWithStructure(extracted.lines, extracted.contentStarts)
  const prose = blankIdentifiers(markdown.lines)
  const structuralProse = blankIdentifiers(markdown.structuralLines)
  const mechanical = blankIdentifiers(
    extracted.lines.map((line, index) =>
      markdown.structuralBlanks[index] ? " ".repeat(line.length) : line,
    ),
  )
  return lintProse(
    prose,
    structuralProse,
    mechanical,
    extracted.contentStarts,
    markdown.structuralBlanks,
    options,
  )
}

export function lint(kind: LintKind, text: string, options: LintOptions = {}): LintReport {
  const extracted = extract(kind, text, options)
  const resolved = {
    maxSentenceWords: options.maxSentenceWords ?? DEFAULT_MAX_SENTENCE_WORDS,
    dictionary: options.dictionary,
    tagger: options.tagger,
  }
  const raw = splitProseRuns(extracted).flatMap((run) => lintExtracted(run, resolved))
  const violations: Violation[] = raw
    .flatMap((violation) => {
      const setting = options.rules?.[violation.ruleId]
      if (setting === undefined) {
        return [violation]
      }
      return setting === "off" ? [] : [{ ...violation, severity: setting }]
    })
    .sort((a, b) => a.line - b.line || a.column - b.column)
  return {
    violations,
    summary: {
      total: violations.length,
      hard: violations.filter((violation) => violation.severity === "hard").length,
    },
  }
}
