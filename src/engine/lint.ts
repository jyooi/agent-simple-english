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

interface ProseRun extends ExtractedProse {
  readonly lineOffset: number
  readonly firstColumnOffset: number
}

const wholeText = (text: string): ExtractedProse => {
  const lines = text.split("\n")
  return { lines, contentStarts: lines.map(() => 0), proseBreaks: [] }
}

const splitProseRuns = (extracted: ExtractedProse): readonly ProseRun[] => {
  const boundaries: readonly (ProseBreak | undefined)[] = [
    undefined,
    ...extracted.proseBreaks,
    undefined,
  ]
  return boundaries.slice(0, -1).map((start, runIndex) => {
    const end = boundaries[runIndex + 1]
    const firstLine = start?.line ?? 0
    const lastLine = end?.line ?? extracted.lines.length - 1
    const firstColumnOffset = Math.min(
      start?.column ?? 0,
      extracted.lines[firstLine]?.length ?? 0,
    )
    const sourceLines = extracted.lines.slice(firstLine, lastLine + 1)
    const lines = sourceLines.map((line, index) => {
      const lineIndex = firstLine + index
      const from = lineIndex === firstLine ? firstColumnOffset : 0
      const to = end?.line === lineIndex ? Math.min(end.column, line.length) : line.length
      return line.slice(from, to)
    })
    const contentStarts = lines.map((line, index) => {
      const lineIndex = firstLine + index
      const from = lineIndex === firstLine ? firstColumnOffset : 0
      const contentStart = extracted.contentStarts[lineIndex] ?? from
      return Math.min(Math.max(contentStart - from, 0), line.length)
    })
    return {
      lines,
      contentStarts,
      proseBreaks: [],
      lineOffset: firstLine,
      firstColumnOffset,
    }
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
    segmentParagraphs(
      structuralLines.map((line, index) => line.slice(contentStarts[index] ?? 0)),
      contentStarts.map((contentStart) => contentStart + 1),
    ),
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
  const raw = splitProseRuns(extracted).flatMap((run) =>
    lintExtracted(run, resolved).map((violation) => ({
      ...violation,
      line: violation.line + run.lineOffset,
      column:
        violation.column + (violation.line === 1 ? run.firstColumnOffset : 0),
    })),
  )
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
