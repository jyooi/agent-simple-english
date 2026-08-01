import type { Dictionary } from "../dictionary/schema.ts"
import { type ProseBreak, extractHashComments, extractSlashComments } from "./comments.ts"
import { type RetainedRange, changedText } from "./diff.ts"
import { blankIdentifiers } from "./identifiers.ts"
import { blankMarkdownCodeWithStructure } from "./markdown.ts"
import { type Paragraph, segmentParagraphs } from "./paragraphs.ts"
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
  readonly sourceOffset: number
}

interface PreparedProse {
  readonly lines: readonly string[]
  readonly structuralLines: readonly string[]
  readonly mechanicalLines: readonly string[]
  readonly structuralBlanks: readonly boolean[]
}

interface ViolationScope {
  readonly kind: "sentence" | "paragraph"
  readonly identity: string
  readonly startOffset: number
  readonly endOffset: number
}

interface ScopedViolation {
  readonly violation: Violation
  readonly scope: ViolationScope
  readonly sentenceIdentity?: string
  readonly occurrenceOffset?: number
}

interface SentenceScopeIndex {
  readonly scopes: readonly ViolationScope[]
  readonly firstScopeByLine: Int32Array
}

interface FindingSearchIndex {
  readonly candidates: ScopedViolation[]
  cursor: number
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

const normalizeIdentity = (text: string): string => text.replace(/\s+/gu, " ").trim()

const lineOffsets = (lines: readonly string[]): readonly number[] => {
  const offsets: number[] = []
  let nextOffset = 0
  for (const line of lines) {
    offsets.push(nextOffset)
    nextOffset += line.length + 1
  }
  return offsets
}

const sentenceScope = (sentence: Sentence, sourceOffset: number): ViolationScope => ({
  kind: "sentence",
  identity: normalizeIdentity(sentence.text),
  startOffset: sourceOffset + sentence.startOffset,
  endOffset: sourceOffset + sentence.endOffset,
})

function paragraphScope(
  paragraph: Paragraph,
  lines: readonly string[],
  offsets: readonly number[],
  sourceOffset: number,
): ViolationScope {
  const endLine = paragraph.line + paragraph.lines.length - 1
  const startOffset = offsets[paragraph.line - 1] ?? 0
  return {
    kind: "paragraph",
    identity: normalizeIdentity(paragraph.lines.join("\n")),
    startOffset: sourceOffset + startOffset,
    endOffset:
      sourceOffset +
      (offsets[endLine - 1] ?? startOffset) +
      (lines[endLine - 1]?.length ?? 0),
  }
}

function indexSentenceScopes(
  sentences: readonly Sentence[],
  lineCount: number,
  sourceOffset: number,
): SentenceScopeIndex {
  const scopes = sentences.map((sentence) => sentenceScope(sentence, sourceOffset))
  const firstScopeByLine = new Int32Array(lineCount).fill(-1)

  for (let scopeIndex = 0; scopeIndex < sentences.length; scopeIndex++) {
    const sentence = sentences[scopeIndex]
    if (sentence === undefined) continue
    for (let line = sentence.line - 1; line < sentence.endLine; line++) {
      if (firstScopeByLine[line] === -1) firstScopeByLine[line] = scopeIndex
    }
  }

  return { scopes, firstScopeByLine }
}

function scopeForViolation(
  violation: Violation,
  sentenceIndex: SentenceScopeIndex,
  lines: readonly string[],
  offsets: readonly number[],
  sourceOffset: number,
): ViolationScope {
  const localOffset = (offsets[violation.line - 1] ?? 0) + violation.column - 1
  const offset = sourceOffset + localOffset
  let low = 0
  let high = sentenceIndex.scopes.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const scope = sentenceIndex.scopes[middle]
    if (scope !== undefined && scope.startOffset <= offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  const containingScope = sentenceIndex.scopes[low - 1]
  if (
    containingScope !== undefined &&
    containingScope.startOffset <= offset &&
    offset < containingScope.endOffset
  ) {
    return containingScope
  }

  const lineScopeIndex = sentenceIndex.firstScopeByLine[violation.line - 1] ?? -1
  const lineScope = sentenceIndex.scopes[lineScopeIndex]
  if (lineScope !== undefined) return lineScope

  const line = lines[violation.line - 1] ?? ""
  const startOffset = offsets[violation.line - 1] ?? 0
  return {
    kind: "sentence",
    identity: normalizeIdentity(line),
    startOffset: sourceOffset + startOffset,
    endOffset: sourceOffset + startOffset + line.length,
  }
}

const lintProse = (
  prepared: PreparedProse,
  contentStarts: readonly number[],
  sourceOffset: number,
  options: ResolvedOptions,
): ScopedViolation[] => {
  const sourceText = prepared.lines.join("\n")
  const sentences = segmentSentences(prepared.lines, sourceText, prepared.structuralBlanks)
  const paragraphs = segmentParagraphs(
    prepared.structuralLines.map((line, index) => line.slice(contentStarts[index] ?? 0)),
    contentStarts.map((contentStart) => contentStart + 1),
  )
  const offsets = lineOffsets(prepared.structuralLines)
  const sentenceIndex = indexSentenceScopes(sentences, prepared.lines.length, sourceOffset)
  const sentenceFindings = (violations: readonly Violation[]): ScopedViolation[] =>
    violations.map((violation) => {
      const scope = scopeForViolation(
        violation,
        sentenceIndex,
        prepared.structuralLines,
        offsets,
        sourceOffset,
      )
      return {
        violation,
        scope,
        sentenceIdentity: scope.identity,
        occurrenceOffset:
          sourceOffset + (offsets[violation.line - 1] ?? 0) + violation.column - 1,
      }
    })

  return [
    ...sentences.flatMap((sentence) =>
      sentenceLength([sentence], options.maxSentenceWords).map((violation) => ({
        violation,
        scope: sentenceScope(sentence, sourceOffset),
      })),
    ),
    ...paragraphs.flatMap((paragraph) =>
      paragraphLength([paragraph]).map((violation) => ({
        violation,
        scope: paragraphScope(paragraph, prepared.structuralLines, offsets, sourceOffset),
      })),
    ),
    ...sentenceFindings(contraction(prepared.lines)),
    ...sentenceFindings(semicolon(prepared.mechanicalLines)),
    ...sentenceFindings(phrasalVerb(prepared.lines)),
    ...sentenceFindings(hedging(prepared.lines)),
    ...sentenceFindings(marketing(prepared.lines)),
    ...(options.dictionary === undefined
      ? []
      : sentenceFindings(
          dictionaryRule(
            prepared.structuralLines,
            options.dictionary,
            options.tagger,
            contentStarts,
          ),
        )),
    ...(options.tagger === undefined
      ? []
      : sentenceFindings(verbForm(prepared.lines, options.tagger))),
  ]
}

const lintExtracted = (extracted: ProseRun, options: ResolvedOptions): ScopedViolation[] =>
  lintProse(prepareProse(extracted), extracted.contentStarts, extracted.sourceOffset, options)

function configuredFinding(
  finding: ScopedViolation,
  options: LintOptions,
): ScopedViolation | undefined {
  const setting = options.rules?.[finding.violation.ruleId]
  if (setting === "off") return undefined
  if (setting === undefined) return finding
  return { ...finding, violation: { ...finding.violation, severity: setting } }
}

function evaluate(
  kind: LintKind,
  text: string,
  options: LintOptions,
): ScopedViolation[] {
  const resolved: ResolvedOptions = {
    maxSentenceWords: options.maxSentenceWords ?? DEFAULT_MAX_SENTENCE_WORDS,
    dictionary: options.dictionary,
    tagger: options.tagger,
  }
  return splitProseRuns(extract(kind, text, options))
    .flatMap((run) =>
      lintExtracted(run, resolved).map((finding) => ({
        ...finding,
        violation: {
          ...finding.violation,
          line: finding.violation.line + run.lineOffset,
          column:
            finding.violation.column +
            (finding.violation.line === 1 ? run.firstColumnOffset : 0),
        },
      })),
    )
    .flatMap((finding) => {
      const configured = configuredFinding(finding, options)
      return configured === undefined ? [] : [configured]
    })
    .sort(
      (left, right) =>
        left.violation.line - right.violation.line ||
        left.violation.column - right.violation.column,
    )
}

const findingKey = (finding: ScopedViolation): string =>
  `${finding.violation.ruleId}\u0000${finding.scope.kind}\u0000${finding.sentenceIdentity ?? ""}`

type RetainedSide = "current" | "previous"

function firstRetainedIndex(
  retained: readonly RetainedRange[],
  offset: number,
  side: RetainedSide,
): number {
  let low = 0
  let high = retained.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const range = retained[middle]
    const start = side === "current" ? range?.currentStart : range?.previousStart
    if (range !== undefined && (start ?? 0) + range.length <= offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

function retainedScopeMapsInto(
  source: ViolationScope,
  target: ViolationScope,
  retained: readonly RetainedRange[],
  sourceSide: RetainedSide,
): boolean {
  let mapped = false
  for (
    let index = firstRetainedIndex(retained, source.startOffset, sourceSide);
    index < retained.length;
    index++
  ) {
    const range = retained[index]
    if (range === undefined) break
    const sourceStart = sourceSide === "current" ? range.currentStart : range.previousStart
    const targetStart = sourceSide === "current" ? range.previousStart : range.currentStart
    if (sourceStart >= source.endOffset) break
    const overlapStart = Math.max(source.startOffset, sourceStart)
    const overlapEnd = Math.min(source.endOffset, sourceStart + range.length)
    if (overlapStart >= overlapEnd) continue
    mapped = true
    const mappedStart = targetStart + overlapStart - sourceStart
    const mappedEnd = targetStart + overlapEnd - sourceStart
    if (mappedStart < target.startOffset || mappedEnd > target.endOffset) return false
  }
  return mapped
}

function scopesCorrespond(
  previous: ViolationScope,
  current: ViolationScope,
  retained: readonly RetainedRange[],
): boolean {
  return (
    retainedScopeMapsInto(current, previous, retained, "current") &&
    retainedScopeMapsInto(previous, current, retained, "previous")
  )
}

function firstMappedPreviousOffset(
  scope: ViolationScope,
  retained: readonly RetainedRange[],
): number | undefined {
  for (
    let index = firstRetainedIndex(retained, scope.startOffset, "current");
    index < retained.length;
    index++
  ) {
    const range = retained[index]
    if (range === undefined || range.currentStart >= scope.endOffset) break
    const overlapStart = Math.max(scope.startOffset, range.currentStart)
    const overlapEnd = Math.min(scope.endOffset, range.currentStart + range.length)
    if (overlapStart < overlapEnd) {
      return range.previousStart + overlapStart - range.currentStart
    }
  }
  return undefined
}

function mappedPreviousOffset(
  offset: number,
  retained: readonly RetainedRange[],
): number | undefined {
  const range = retained[firstRetainedIndex(retained, offset, "current")]
  if (
    range === undefined ||
    offset < range.currentStart ||
    offset >= range.currentStart + range.length
  ) {
    return undefined
  }
  return range.previousStart + offset - range.currentStart
}

function newFindings(
  previous: readonly ScopedViolation[],
  current: readonly ScopedViolation[],
  retained: readonly RetainedRange[],
): ScopedViolation[] {
  const previousByKey = new Map<string, FindingSearchIndex>()
  for (const finding of previous) {
    const key = findingKey(finding)
    const index = previousByKey.get(key)
    if (index === undefined) {
      previousByKey.set(key, { candidates: [finding], cursor: 0 })
    } else {
      index.candidates.push(finding)
    }
  }

  const findings: ScopedViolation[] = []
  for (const finding of current) {
    const index = previousByKey.get(findingKey(finding))
    const mappedScopeOffset = firstMappedPreviousOffset(finding.scope, retained)
    const mappedOccurrenceOffset =
      finding.occurrenceOffset === undefined
        ? undefined
        : mappedPreviousOffset(finding.occurrenceOffset, retained)
    if (
      index === undefined ||
      mappedScopeOffset === undefined ||
      (finding.occurrenceOffset !== undefined && mappedOccurrenceOffset === undefined)
    ) {
      findings.push(finding)
      continue
    }

    let matched = false
    while (index.cursor < index.candidates.length) {
      const candidate = index.candidates[index.cursor]
      if (candidate === undefined) break
      if (candidate.scope.endOffset <= mappedScopeOffset) {
        index.cursor++
        continue
      }
      if (candidate.scope.startOffset > mappedScopeOffset) break
      if (!scopesCorrespond(candidate.scope, finding.scope, retained)) {
        index.cursor++
        continue
      }
      if (finding.occurrenceOffset === undefined) {
        index.cursor++
        matched = true
        break
      }
      if (
        candidate.occurrenceOffset !== undefined &&
        candidate.occurrenceOffset < (mappedOccurrenceOffset ?? 0)
      ) {
        index.cursor++
        continue
      }
      if (candidate.occurrenceOffset !== mappedOccurrenceOffset) break
      index.cursor++
      matched = true
      break
    }
    if (!matched) findings.push(finding)
  }

  return findings
}

export function lint(kind: LintKind, text: string, options: LintOptions = {}): LintReport {
  const current = evaluate(kind, text, options)
  const findings =
    options.previousText === undefined
      ? current
      : newFindings(
          evaluate(kind, options.previousText, options),
          current,
          changedText(options.previousText, text).retained,
        )
  const violations = findings.map((finding) => finding.violation)
  return {
    violations,
    summary: {
      total: violations.length,
      hard: violations.filter((violation) => violation.severity === "hard").length,
    },
  }
}
