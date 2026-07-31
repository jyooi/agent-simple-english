import type { Dictionary } from "../dictionary/schema.ts"
import { type ProseBreak, extractHashComments, extractSlashComments } from "./comments.ts"
import { type ChangedRange, type RetainedRange, type TextChanges, changedText } from "./diff.ts"
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
import { type Sentence, segmentSentences } from "./sentences.ts"
import type { Tagger } from "./tagger.ts"
import type { LintKind, LintOptions, LintReport, Violation } from "./types.ts"

export const DEFAULT_MAX_SENTENCE_WORDS = 25

type SentenceSelector = (
  sentences: readonly Sentence[],
  sourceOffset: number,
) => readonly Sentence[]

interface ResolvedOptions {
  readonly maxSentenceWords: number
  readonly dictionary?: Dictionary
  readonly tagger?: Tagger
  readonly selectSentences: SentenceSelector
  readonly diffOnly: boolean
}

function selectedProseLines(text: string, sentences: readonly Sentence[]): string[] {
  const selected: string[] = Array.from({ length: text.length }, (_, offset) => {
    const character = text[offset]
    return character === "\n" || character === "\r" ? character : " "
  })
  for (const sentence of sentences) {
    for (const range of sentence.contentRanges) {
      for (let offset = range.start; offset < range.end; offset++) {
        selected[offset] = text[offset] ?? " "
      }
    }
  }
  return selected.join("").split("\n")
}

interface ExtractedProse {
  readonly lines: readonly string[]
  readonly contentStarts: readonly number[]
  readonly proseBreaks: readonly ProseBreak[]
}

interface ProseRun extends ExtractedProse {
  readonly lineOffset: number
  readonly firstColumnOffset: number
  readonly sourceOffset: number
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
  const lineOffsets: number[] = []
  let nextLineOffset = 0
  for (const line of extracted.lines) {
    lineOffsets.push(nextLineOffset)
    nextLineOffset += line.length + 1
  }
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
      sourceOffset: (lineOffsets[firstLine] ?? 0) + firstColumnOffset,
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
  sourceOffset: number,
  { maxSentenceWords, dictionary, tagger, selectSentences, diffOnly }: ResolvedOptions,
) => {
  const sentences = selectSentences(
    segmentSentences(lines, lines.join("\n"), structuralBlanks),
    sourceOffset,
  )
  const selectedProse = diffOnly ? selectedProseLines(lines.join("\n"), sentences) : lines
  const selectedStructural = diffOnly
    ? selectedProseLines(structuralLines.join("\n"), sentences)
    : structuralLines
  const selectedMechanical = diffOnly
    ? selectedProseLines(mechanicalLines.join("\n"), sentences)
    : mechanicalLines
  return [
    ...sentenceLength(sentences, maxSentenceWords),
    ...paragraphLength(
      segmentParagraphs(
        selectedStructural.map((line, index) => line.slice(contentStarts[index] ?? 0)),
        contentStarts.map((contentStart) => contentStart + 1),
      ),
    ),
    ...contraction(selectedProse),
    ...semicolon(selectedMechanical),
    ...phrasalVerb(selectedProse),
    ...hedging(selectedProse),
    ...marketing(selectedProse),
    ...(dictionary === undefined
      ? []
      : dictionaryRule(selectedStructural, dictionary, tagger, contentStarts)),
    ...(tagger === undefined ? [] : verbForm(selectedProse, tagger)),
  ]
}

interface PreparedProse {
  readonly lines: readonly string[]
  readonly structuralLines: readonly string[]
  readonly mechanicalLines: readonly string[]
  readonly structuralBlanks: readonly boolean[]
}

const prepareProse = (extracted: ProseRun): PreparedProse => {
  const markdown = blankMarkdownCodeWithStructure(extracted.lines, extracted.contentStarts)
  return {
    lines: blankIdentifiers(markdown.lines),
    structuralLines: blankIdentifiers(markdown.structuralLines),
    mechanicalLines: blankIdentifiers(
      extracted.lines.map((line, index) =>
        markdown.structuralBlanks[index] ? " ".repeat(line.length) : line,
      ),
    ),
    structuralBlanks: markdown.structuralBlanks,
  }
}

const absoluteSentence = (sentence: Sentence, sourceOffset: number): Sentence => ({
  ...sentence,
  startOffset: sentence.startOffset + sourceOffset,
  endOffset: sentence.endOffset + sourceOffset,
  contentRanges: sentence.contentRanges.map((range) => ({
    start: range.start + sourceOffset,
    end: range.end + sourceOffset,
  })),
})

interface AnalyzedText {
  readonly prose: string
  readonly sentences: readonly Sentence[]
}

const analyzeText = (kind: LintKind, text: string, options: LintOptions): AnalyzedText => {
  const prose = text
    .split("")
    .map((character) => (character === "\n" || character === "\r" ? character : " "))
  const sentences = splitProseRuns(extract(kind, text, options)).flatMap((run) => {
    const prepared = prepareProse(run)
    const runText = prepared.lines.join("\n")
    for (let offset = 0; offset < runText.length; offset++) {
      prose[run.sourceOffset + offset] = runText[offset] ?? " "
    }
    return segmentSentences(prepared.lines, runText, prepared.structuralBlanks).map((sentence) =>
      absoluteSentence(sentence, run.sourceOffset),
    )
  })
  return { prose: prose.join(""), sentences }
}

const lintExtracted = (extracted: ProseRun, options: ResolvedOptions): Violation[] => {
  const prepared = prepareProse(extracted)
  return lintProse(
    prepared.lines,
    prepared.structuralLines,
    prepared.mechanicalLines,
    extracted.contentStarts,
    prepared.structuralBlanks,
    extracted.sourceOffset,
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

interface CorrespondingOffset {
  readonly current: number
  readonly previous: number
}

function nearestRetainedProseBefore(
  text: string,
  retained: readonly RetainedRange[],
  offsets: readonly number[],
): Array<CorrespondingOffset | undefined> {
  const ordered = offsets
    .map((offset, index) => ({ offset, index }))
    .sort((left, right) => left.offset - right.offset)
  const result: Array<CorrespondingOffset | undefined> = new Array(offsets.length)
  let cursor = 0
  let retainedIndex = 0
  let nearest: CorrespondingOffset | undefined

  for (const query of ordered) {
    while (cursor < query.offset && cursor < text.length) {
      while (
        retainedIndex < retained.length &&
        (retained[retainedIndex]?.currentStart ?? 0) + (retained[retainedIndex]?.length ?? 0) <=
          cursor
      ) {
        retainedIndex++
      }
      const range = retained[retainedIndex]
      if (
        range &&
        range.currentStart <= cursor &&
        cursor < range.currentStart + range.length &&
        !/\s/u.test(text[cursor] ?? "")
      ) {
        nearest = {
          current: cursor,
          previous: range.previousStart + cursor - range.currentStart,
        }
      }
      cursor++
    }
    result[query.index] = nearest
  }

  return result
}

function nearestRetainedProseAfter(
  text: string,
  retained: readonly RetainedRange[],
  offsets: readonly number[],
): Array<CorrespondingOffset | undefined> {
  const ordered = offsets
    .map((offset, index) => ({ offset, index }))
    .sort((left, right) => right.offset - left.offset)
  const result: Array<CorrespondingOffset | undefined> = new Array(offsets.length)
  let cursor = text.length - 1
  let retainedIndex = retained.length - 1
  let nearest: CorrespondingOffset | undefined

  for (const query of ordered) {
    while (cursor >= query.offset) {
      while (
        retainedIndex >= 0 &&
        cursor < (retained[retainedIndex]?.currentStart ?? Number.POSITIVE_INFINITY)
      ) {
        retainedIndex--
      }
      const range = retained[retainedIndex]
      if (
        range &&
        range.currentStart <= cursor &&
        cursor < range.currentStart + range.length &&
        !/\s/u.test(text[cursor] ?? "")
      ) {
        nearest = {
          current: cursor,
          previous: range.previousStart + cursor - range.currentStart,
        }
      }
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
  previousProse: string,
  currentProse: string,
  changes: TextChanges,
): ChangedRange[] {
  const ranges: ChangedRange[] = []

  for (const retained of changes.retained) {
    let rangeStart: number | undefined
    for (let index = 0; index < retained.length; index++) {
      const previousOffset = retained.previousStart + index
      const currentOffset = retained.currentStart + index
      const newlyVisible =
        !/\S/u.test(previousProse[previousOffset] ?? "") &&
        /\S/u.test(currentProse[currentOffset] ?? "")
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

interface DeletionBoundary {
  readonly before?: number
  readonly after?: number
}

function deletionBoundaryStart(boundary: DeletionBoundary): number {
  return boundary.before ?? boundary.after ?? Number.POSITIVE_INFINITY
}

function deletionBoundaryEnd(boundary: DeletionBoundary): number {
  return boundary.after ?? boundary.before ?? Number.NEGATIVE_INFINITY
}

function deletionBoundaries(
  previousProse: string,
  currentProse: string,
  previousSentences: readonly Sentence[],
  changes: TextChanges,
): DeletionBoundary[] {
  const previousStarts = changes.deletions.map((deletion) => deletion.previousStart)
  const previousEnds = changes.deletions.map((deletion) => deletion.previousEnd)
  const currentOffsets = changes.deletions.map((deletion) => deletion.currentOffset)
  const oldBefore = nearestNonWhitespaceBefore(previousProse, previousStarts)
  const oldAfter = nearestNonWhitespaceAfter(previousProse, previousEnds)
  const newBefore = nearestNonWhitespaceBefore(currentProse, currentOffsets)
  const newAfter = nearestNonWhitespaceAfter(currentProse, currentOffsets)
  const deletedFirst = nearestNonWhitespaceAfter(previousProse, previousStarts).map(
    (offset, index) =>
      offset !== undefined && offset < (changes.deletions[index]?.previousEnd ?? 0)
        ? offset
        : undefined,
  )
  const deletedLast = nearestNonWhitespaceBefore(previousProse, previousEnds).map(
    (offset, index) =>
      offset !== undefined && offset >= (changes.deletions[index]?.previousStart ?? 0)
        ? offset
        : undefined,
  )
  const oldBeforeSentences = containingSentenceIndexes(previousSentences, oldBefore)
  const oldAfterSentences = containingSentenceIndexes(previousSentences, oldAfter)
  const deletedFirstSentences = containingSentenceIndexes(previousSentences, deletedFirst)
  const deletedLastSentences = containingSentenceIndexes(previousSentences, deletedLast)
  const boundaries: DeletionBoundary[] = []

  for (let index = 0; index < changes.deletions.length; index++) {
    const deletion = changes.deletions[index]
    const before = newBefore[index]
    const after = newAfter[index]
    if (deletion === undefined || (before === undefined && after === undefined)) continue

    const beforeSentence = oldBeforeSentences[index] ?? -1
    const afterSentence = oldAfterSentences[index] ?? -1
    const deletedProse = previousProse.slice(deletion.previousStart, deletion.previousEnd)

    if (before !== undefined && after !== undefined) {
      if (beforeSentence === -1 || afterSentence === -1) continue
      const previousTogether = beforeSentence === afterSentence
      if (previousTogether && !/\S/u.test(deletedProse) && before + 1 < after) continue
      boundaries.push({ before, after })
      continue
    }

    if (!/\S/u.test(deletedProse)) continue
    if (
      before === undefined &&
      after !== undefined &&
      afterSentence !== -1 &&
      deletedLastSentences[index] === afterSentence
    ) {
      boundaries.push({ after })
    }
    if (
      after === undefined &&
      before !== undefined &&
      beforeSentence !== -1 &&
      deletedFirstSentences[index] === beforeSentence
    ) {
      boundaries.push({ before })
    }
  }

  return boundaries.sort(
    (left, right) =>
      deletionBoundaryStart(left) - deletionBoundaryStart(right) ||
      deletionBoundaryEnd(left) - deletionBoundaryEnd(right),
  )
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

function changedSentenceIdentityIndexes(
  previousSentences: readonly Sentence[],
  currentSentences: readonly Sentence[],
  previousProse: string,
  currentProse: string,
  changes: TextChanges,
): ReadonlySet<number> {
  const insertedRanges = normalizeRanges(changes.ranges)
  const before = nearestRetainedProseBefore(
    currentProse,
    changes.retained,
    insertedRanges.map((range) => range.start),
  )
  const after = nearestRetainedProseAfter(
    currentProse,
    changes.retained,
    insertedRanges.map((range) => range.end),
  )
  const retainedOffsets = [...before, ...after]
  const currentIndexes = containingSentenceIndexes(
    currentSentences,
    retainedOffsets.map((offset) => offset?.current),
  )
  const previousIndexes = containingSentenceIndexes(
    previousSentences,
    retainedOffsets.map((offset) => offset?.previous),
  )
  const deletionBeforeOffsets = nearestNonWhitespaceBefore(
    previousProse,
    changes.deletions.map((deletion) => deletion.previousEnd),
  ).map((offset, index) =>
    offset !== undefined && offset >= (changes.deletions[index]?.previousStart ?? 0)
      ? offset
      : undefined,
  )
  const deletionAfterOffsets = nearestNonWhitespaceAfter(
    previousProse,
    changes.deletions.map((deletion) => deletion.previousStart),
  ).map((offset, index) =>
    offset !== undefined && offset < (changes.deletions[index]?.previousEnd ?? 0)
      ? offset
      : undefined,
  )
  const deletionBeforeIndexes = containingSentenceIndexes(previousSentences, deletionBeforeOffsets)
  const deletionAfterIndexes = containingSentenceIndexes(previousSentences, deletionAfterOffsets)
  const deletionEdges = changes.deletions
    .map((deletion, index) => ({
      currentOffset: deletion.currentOffset,
      beforeSentence: deletionBeforeIndexes[index] ?? -1,
      afterSentence: deletionAfterIndexes[index] ?? -1,
    }))
    .sort((left, right) => left.currentOffset - right.currentOffset)
  const changed = new Set<number>()
  let deletionIndex = 0

  for (let rangeIndex = 0; rangeIndex < insertedRanges.length; rangeIndex++) {
    const range = insertedRanges[rangeIndex]
    if (!range) continue
    const beforeOffset = before[rangeIndex]
    const afterOffset = after[rangeIndex]
    const beforeCurrent = currentIndexes[rangeIndex] ?? -1
    const afterCurrent = currentIndexes[insertedRanges.length + rangeIndex] ?? -1
    const beforePrevious = previousIndexes[rangeIndex] ?? -1
    const afterPrevious = previousIndexes[insertedRanges.length + rangeIndex] ?? -1
    const hasBefore = beforeOffset !== undefined && beforeCurrent !== -1 && beforePrevious !== -1
    const hasAfter = afterOffset !== undefined && afterCurrent !== -1 && afterPrevious !== -1

    if (hasBefore && hasAfter) {
      const previousTogether = beforePrevious === afterPrevious
      const currentTogether = beforeCurrent === afterCurrent
      if (previousTogether !== currentTogether) {
        changed.add(beforeCurrent)
        changed.add(afterCurrent)
      } else if (
        previousTogether &&
        currentTogether &&
        beforeOffset.previous + 1 === afterOffset.previous &&
        beforeOffset.current + 1 < afterOffset.current
      ) {
        let separatorOnly = true
        for (let offset = range.start; offset < range.end; offset++) {
          if (!/\s/u.test(currentProse[offset] ?? "")) {
            separatorOnly = false
            break
          }
        }
        if (separatorOnly) changed.add(beforeCurrent)
      }
    }

    while (
      deletionIndex < deletionEdges.length &&
      (deletionEdges[deletionIndex]?.currentOffset ?? 0) < range.start
    ) {
      deletionIndex++
    }
    for (
      let localDeletion = deletionIndex;
      localDeletion < deletionEdges.length &&
      (deletionEdges[localDeletion]?.currentOffset ?? Number.POSITIVE_INFINITY) <= range.end;
      localDeletion++
    ) {
      const deletion = deletionEdges[localDeletion]
      if (!deletion) continue
      if (!hasBefore && hasAfter && deletion.beforeSentence === afterPrevious) {
        changed.add(afterCurrent)
      }
      if (hasBefore && !hasAfter && deletion.afterSentence === beforePrevious) {
        changed.add(beforeCurrent)
      }
    }
  }

  return changed
}

function selectChangedSentences(
  sentences: readonly Sentence[],
  changedRanges: readonly ChangedRange[],
  deletionBoundaries: readonly DeletionBoundary[],
  changedSentenceIndexes: ReadonlySet<number>,
): Sentence[] {
  const selected: Sentence[] = []
  let rangeIndex = 0
  let boundaryIndex = 0

  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
    const sentence = sentences[sentenceIndex]
    if (!sentence) continue
    while (
      rangeIndex < changedRanges.length &&
      (changedRanges[rangeIndex]?.end ?? 0) <= sentence.startOffset
    ) {
      rangeIndex++
    }
    let intersectsRange = false
    for (const contentRange of sentence.contentRanges) {
      while (
        rangeIndex < changedRanges.length &&
        (changedRanges[rangeIndex]?.end ?? 0) <= contentRange.start
      ) {
        rangeIndex++
      }
      const range = changedRanges[rangeIndex]
      if (range && range.start < contentRange.end && range.end > contentRange.start) {
        intersectsRange = true
        break
      }
    }

    while (
      boundaryIndex < deletionBoundaries.length &&
      deletionBoundaryEnd(deletionBoundaries[boundaryIndex] ?? {}) < sentence.startOffset
    ) {
      boundaryIndex++
    }
    let nextBoundary = boundaryIndex
    let containsBoundary = false
    while (
      nextBoundary < deletionBoundaries.length &&
      deletionBoundaryStart(deletionBoundaries[nextBoundary] ?? {}) < sentence.endOffset
    ) {
      const boundary = deletionBoundaries[nextBoundary]
      if (
        boundary &&
        (boundary.before === undefined || contains(sentence, boundary.before)) &&
        (boundary.after === undefined || contains(sentence, boundary.after))
      ) {
        containsBoundary = true
      }
      nextBoundary++
    }
    boundaryIndex = nextBoundary

    if (intersectsRange || containsBoundary || changedSentenceIndexes.has(sentenceIndex)) {
      selected.push(sentence)
    }
  }

  return selected
}

function sentenceSelector(kind: LintKind, text: string, options: LintOptions): SentenceSelector {
  const previousText = options.previousText
  if (previousText === undefined) return (sentences) => sentences

  const changes = changedText(previousText, text)
  const previous = analyzeText(kind, previousText, options)
  const current = analyzeText(kind, text, options)
  const changedRanges = normalizeRanges([
    ...changes.ranges,
    ...newlyVisibleRanges(previous.prose, current.prose, changes),
  ])
  const changedDeletionBoundaries = deletionBoundaries(
    previous.prose,
    current.prose,
    previous.sentences,
    changes,
  )
  const changedSentenceIndexes = changedSentenceIdentityIndexes(
    previous.sentences,
    current.sentences,
    previous.prose,
    current.prose,
    changes,
  )
  const selected = new Set(
    selectChangedSentences(
      current.sentences,
      changedRanges,
      changedDeletionBoundaries,
      changedSentenceIndexes,
    ).map((sentence) => `${sentence.startOffset}:${sentence.endOffset}`),
  )

  return (sentences, sourceOffset) =>
    sentences.filter((sentence) => {
      const absolute = absoluteSentence(sentence, sourceOffset)
      return selected.has(`${absolute.startOffset}:${absolute.endOffset}`)
    })
}

export function lint(kind: LintKind, text: string, options: LintOptions = {}): LintReport {
  const extracted = extract(kind, text, options)
  const resolved = {
    maxSentenceWords: options.maxSentenceWords ?? DEFAULT_MAX_SENTENCE_WORDS,
    dictionary: options.dictionary,
    tagger: options.tagger,
    selectSentences: sentenceSelector(kind, text, options),
    diffOnly: options.previousText !== undefined,
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
      if (setting === undefined) return [violation]
      return setting === "off" ? [] : [{ ...violation, severity: setting }]
    })
    .sort((left, right) => left.line - right.line || left.column - right.column)
  return {
    violations,
    summary: {
      total: violations.length,
      hard: violations.filter((violation) => violation.severity === "hard").length,
    },
  }
}
