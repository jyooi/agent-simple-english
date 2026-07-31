import type { Dictionary } from "../dictionary/schema.ts"
import { type ProseBreak, extractHashComments, extractSlashComments } from "./comments.ts"
import { type ChangedRange, changedText, type TextChanges } from "./diff.ts"
import { blankIdentifiers } from "./identifiers.ts"
import {
  blankMarkdownCodeWithStructure,
  maskMarkdownCode,
  proseVisibility,
} from "./markdown.ts"
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
import { type Sentence, segmentSentences } from "./sentences.ts"
import type { Tagger } from "./tagger.ts"
import type { LintKind, LintOptions, LintReport, Violation } from "./types.ts"

export const DEFAULT_MAX_SENTENCE_WORDS = 25

type SentenceSelector = (sentences: readonly Sentence[]) => readonly Sentence[]

interface ResolvedOptions {
  readonly maxSentenceWords: number
  readonly dictionary?: Dictionary
  readonly tagger?: Tagger
  readonly selectSentences: SentenceSelector
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
    const firstColumnOffset = Math.min(start?.column ?? 0, extracted.lines[firstLine]?.length ?? 0)
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
  { maxSentenceWords, dictionary, tagger, selectSentences }: ResolvedOptions,
) => [
  ...sentenceLength(
    selectSentences(segmentSentences(lines, lines.join("\n"), structuralBlanks)),
    maxSentenceWords,
  ),
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

function nearestNonWhitespaceBefore(
  text: string,
  offsets: readonly number[],
): Array<number | undefined> {
  const ordered = offsets
    .map((offset, index) => ({ offset, index }))
    .sort((left, right) => left.offset - right.offset)
  const result: Array<number | undefined> = new Array(offsets.length)
  let cursor = 0
  let nearest: number | undefined

  for (const query of ordered) {
    while (cursor < query.offset && cursor < text.length) {
      if (!/\s/u.test(text[cursor] ?? "")) nearest = cursor
      cursor++
    }
    result[query.index] = nearest
  }

  return result
}

function nearestNonWhitespaceAfter(
  text: string,
  offsets: readonly number[],
): Array<number | undefined> {
  const ordered = offsets
    .map((offset, index) => ({ offset, index }))
    .sort((left, right) => right.offset - left.offset)
  const result: Array<number | undefined> = new Array(offsets.length)
  let cursor = text.length - 1
  let nearest: number | undefined

  for (const query of ordered) {
    while (cursor >= query.offset) {
      if (!/\s/u.test(text[cursor] ?? "")) nearest = cursor
      cursor--
    }
    result[query.index] = nearest
  }

  return result
}

function contains(sentence: Sentence, offset: number): boolean {
  return sentence.startOffset <= offset && offset < sentence.endOffset
}

function newlyVisibleRanges(
  previousText: string,
  text: string,
  changes: TextChanges,
): ChangedRange[] {
  const previousVisibility = proseVisibility(previousText)
  const currentVisibility = proseVisibility(text)
  const ranges: ChangedRange[] = []

  for (const retained of changes.retained) {
    let rangeStart: number | undefined
    for (let index = 0; index < retained.length; index++) {
      const previousOffset = retained.previousStart + index
      const currentOffset = retained.currentStart + index
      const newlyVisible =
        previousVisibility[previousOffset] === 0 && currentVisibility[currentOffset] === 1
      if (newlyVisible && rangeStart === undefined) rangeStart = currentOffset
      if (!newlyVisible && rangeStart !== undefined) {
        ranges.push({ start: rangeStart, end: currentOffset })
        rangeStart = undefined
      }
    }
    if (rangeStart !== undefined) {
      ranges.push({ start: rangeStart, end: retained.currentStart + retained.length })
    }
  }

  return ranges
}

function containingSentenceIndexes(
  sentences: readonly Sentence[],
  offsets: readonly (number | undefined)[],
): number[] {
  const ordered: Array<{ offset: number; index: number }> = []
  for (let index = 0; index < offsets.length; index++) {
    const offset = offsets[index]
    if (offset !== undefined) ordered.push({ offset, index })
  }
  ordered.sort((left, right) => left.offset - right.offset)

  const result = new Array<number>(offsets.length).fill(-1)
  let sentenceIndex = 0
  for (const query of ordered) {
    while (
      sentenceIndex < sentences.length &&
      (sentences[sentenceIndex]?.endOffset ?? 0) <= query.offset
    ) {
      sentenceIndex++
    }
    const sentence = sentences[sentenceIndex]
    if (sentence && contains(sentence, query.offset)) result[query.index] = sentenceIndex
  }
  return result
}

interface MergedBoundary {
  readonly before: number
  readonly after: number
}

function deletionMergeBoundaries(
  previousProse: string,
  currentProse: string,
  previousSentences: readonly Sentence[],
  changes: TextChanges,
): MergedBoundary[] {
  const previousStarts = changes.deletions.map((deletion) => deletion.previousStart)
  const previousEnds = changes.deletions.map((deletion) => deletion.previousEnd)
  const currentOffsets = changes.deletions.map((deletion) => deletion.currentOffset)
  const oldBefore = nearestNonWhitespaceBefore(previousProse, previousStarts)
  const oldAfter = nearestNonWhitespaceAfter(previousProse, previousEnds)
  const newBefore = nearestNonWhitespaceBefore(currentProse, currentOffsets)
  const newAfter = nearestNonWhitespaceAfter(currentProse, currentOffsets)
  const oldBeforeSentences = containingSentenceIndexes(previousSentences, oldBefore)
  const oldAfterSentences = containingSentenceIndexes(previousSentences, oldAfter)
  const boundaries: MergedBoundary[] = []

  for (let index = 0; index < changes.deletions.length; index++) {
    const before = newBefore[index]
    const after = newAfter[index]
    if (
      oldBefore[index] === undefined ||
      oldAfter[index] === undefined ||
      before === undefined ||
      after === undefined
    ) {
      continue
    }
    const beforeSentence = oldBeforeSentences[index]
    if (beforeSentence !== -1 && beforeSentence === oldAfterSentences[index]) continue
    boundaries.push({ before, after })
  }

  return boundaries.sort((left, right) => left.before - right.before || left.after - right.after)
}

function normalizeRanges(ranges: readonly ChangedRange[]): ChangedRange[] {
  const ordered = ranges
    .filter((range) => range.start < range.end)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const normalized: ChangedRange[] = []

  for (const range of ordered) {
    const last = normalized.at(-1)
    if (last && range.start <= last.end) {
      normalized[normalized.length - 1] = {
        start: last.start,
        end: Math.max(last.end, range.end),
      }
    } else {
      normalized.push(range)
    }
  }

  return normalized
}

function selectChangedSentences(
  sentences: readonly Sentence[],
  changedRanges: readonly ChangedRange[],
  mergedBoundaries: readonly MergedBoundary[],
): Sentence[] {
  const selected: Sentence[] = []
  let rangeIndex = 0
  let boundaryIndex = 0

  for (const sentence of sentences) {
    while (
      rangeIndex < changedRanges.length &&
      (changedRanges[rangeIndex]?.end ?? 0) <= sentence.startOffset
    ) {
      rangeIndex++
    }
    const range = changedRanges[rangeIndex]
    const intersectsRange =
      range !== undefined && range.start < sentence.endOffset && range.end > sentence.startOffset

    while (
      boundaryIndex < mergedBoundaries.length &&
      (mergedBoundaries[boundaryIndex]?.before ?? 0) < sentence.startOffset
    ) {
      boundaryIndex++
    }
    let nextBoundary = boundaryIndex
    let containsBoundary = false
    while (
      nextBoundary < mergedBoundaries.length &&
      (mergedBoundaries[nextBoundary]?.before ?? Number.POSITIVE_INFINITY) < sentence.endOffset
    ) {
      const boundary = mergedBoundaries[nextBoundary]
      if (boundary && contains(sentence, boundary.before) && contains(sentence, boundary.after)) {
        containsBoundary = true
      }
      nextBoundary++
    }
    boundaryIndex = nextBoundary

    if (intersectsRange || containsBoundary) selected.push(sentence)
  }

  return selected
}

function sentenceSelector(text: string, previousText: string | undefined): SentenceSelector {
  if (previousText === undefined) return (sentences) => sentences

  const changes = changedText(previousText, text)
  const previousProse = maskMarkdownCode(previousText)
  const currentProse = maskMarkdownCode(text)
  const changedRanges = normalizeRanges([
    ...changes.ranges,
    ...newlyVisibleRanges(previousText, text, changes),
  ])
  const previousSentences = segmentSentences(previousProse.split("\n"), previousText)
  const mergedBoundaries = deletionMergeBoundaries(
    previousProse,
    currentProse,
    previousSentences,
    changes,
  )

  return (sentences) => selectChangedSentences(sentences, changedRanges, mergedBoundaries)
}

export function lint(kind: LintKind, text: string, options: LintOptions = {}): LintReport {
  const extracted = extract(kind, text, options)
  const resolved = {
    maxSentenceWords: options.maxSentenceWords ?? DEFAULT_MAX_SENTENCE_WORDS,
    dictionary: options.dictionary,
    tagger: options.tagger,
    selectSentences: sentenceSelector(text, options.previousText),
  }
  const raw = splitProseRuns(extracted).flatMap((run) =>
    lintExtracted(run, resolved).map((violation) => ({
      ...violation,
      line: violation.line + run.lineOffset,
      column: violation.column + (violation.line === 1 ? run.firstColumnOffset : 0),
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
