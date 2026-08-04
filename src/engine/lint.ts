import { BUNDLED_RULE_DATA } from "../dictionary/bundled-rule-data.ts"
import type { RuleData } from "../dictionary/rule-data.ts"
import {
  type LineCommentSpan,
  type ProseBreak,
  extractHashComments,
  extractSlashComments,
} from "./comments.ts"
import { type ScopedViolation, type ViolationScope, newFindings } from "./diff-match.ts"
import { changedText } from "./diff.ts"
import { blankIdentifiers } from "./identifiers.ts"
import { blankMarkdownForLint } from "./markdown.ts"
import { type Paragraph, segmentParagraphs } from "./paragraphs.ts"
import { contraction } from "./rules/contraction.ts"
import { type CompiledDictionary, compileDictionary, dictionaryRule } from "./rules/dictionary.ts"
import { hedging } from "./rules/hedging.ts"
import { marketing } from "./rules/marketing.ts"
import { paragraphLength } from "./rules/paragraph-length.ts"
import { phrasalVerb } from "./rules/phrasal-verb.ts"
import { semicolon } from "./rules/semicolon.ts"
import { sentenceLength } from "./rules/sentence-length.ts"
import { verbForm } from "./rules/verb-form.ts"
import { type Sentence, segmentSentences } from "./sentences.ts"
import { type SuppressionRange, analyzeSuppressions } from "./suppression.ts"
import type { Tagger } from "./tagger.ts"
import type { LintKind, LintOptions, LintReport, Violation } from "./types.ts"

export const DEFAULT_MAX_SENTENCE_WORDS = 25

interface ResolvedOptions {
  readonly maxSentenceWords: number
  readonly exemptBlockQuotes: boolean
  readonly dictionary?: CompiledDictionary
  readonly ruleData?: RuleData
  readonly tagger?: Tagger
}

interface ExtractedProse {
  readonly lines: readonly string[]
  readonly contentStarts: readonly number[]
  readonly proseBreaks: readonly ProseBreak[]
  readonly lineComments: readonly LineCommentSpan[]
}

interface ProseRun {
  readonly lines: readonly string[]
  readonly contentStarts: readonly number[]
  readonly proseBreaks: readonly ProseBreak[]
  readonly lineOffset: number
  readonly firstColumnOffset: number
  readonly sourceOffset: number
}

interface PreparedProse {
  readonly lines: readonly string[]
  readonly boundaryLines: readonly string[]
  readonly structuralLines: readonly string[]
  readonly structuralBoundaryLines: readonly string[]
  readonly wordingLines: readonly string[]
  readonly wordingBoundaryLines: readonly string[]
  readonly wordingDictionaryLines: readonly string[]
  readonly wordingDictionaryBoundaryLines: readonly string[]
  readonly wordingStructuralLines: readonly string[]
  readonly structuralBlanks: readonly boolean[]
  readonly wordingStructuralBlanks: readonly boolean[]
  readonly sentenceBoundaryLines: readonly boolean[]
}

interface SentenceScopeIndex {
  readonly scopes: readonly ViolationScope[]
  readonly firstScopeByLine: Int32Array
}

const wholeText = (text: string): ExtractedProse => {
  const lines = text.split("\n")
  return { lines, contentStarts: lines.map(() => 0), proseBreaks: [], lineComments: [] }
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
  if (kind === "slash-source") return extractSlashComments(text, options.sourceDialect)
  if (kind === "hash-source") return extractHashComments(text, options.sourceDialect)
  return wholeText(text)
}

const blankDirectiveRanges = (
  extracted: ExtractedProse,
  directiveRanges: readonly SuppressionRange[],
): ExtractedProse => {
  const rangesByLine = new Map<number, SuppressionRange[]>()
  for (const range of directiveRanges) {
    const ranges = rangesByLine.get(range.line) ?? []
    ranges.push(range)
    rangesByLine.set(range.line, ranges)
  }

  return {
    ...extracted,
    lines: extracted.lines.map((line, index) => {
      const characters = line.split("")
      for (const range of rangesByLine.get(index + 1) ?? []) {
        characters.fill(" ", range.startColumn, range.endColumn)
      }
      return characters.join("")
    }),
  }
}

const isApprovedWordMode = (dictionary: CompiledDictionary | undefined): boolean =>
  dictionary?.mode === "approved-words"

const prepareProse = (
  extracted: ProseRun,
  approvedWordMode: boolean,
  exemptBlockQuotes: boolean,
): PreparedProse => {
  const markdown = blankMarkdownForLint(
    extracted.lines,
    extracted.contentStarts,
    approvedWordMode,
    exemptBlockQuotes,
  )
  const lines = blankIdentifiers(markdown.lines)
  const structuralLines = blankIdentifiers(markdown.structuralLines)
  const wordingBoundaryLines = exemptBlockQuotes ? markdown.wordingLines : markdown.lines
  const wordingLines = exemptBlockQuotes ? blankIdentifiers(wordingBoundaryLines) : lines
  const wordingStructuralLines = exemptBlockQuotes
    ? blankIdentifiers(markdown.wordingStructuralLines)
    : structuralLines
  const wordingDictionaryBoundaryLines = approvedWordMode
    ? exemptBlockQuotes
      ? markdown.wordingDictionaryLines
      : markdown.dictionaryLines
    : wordingBoundaryLines
  const wordingDictionaryLines = approvedWordMode
    ? blankIdentifiers(wordingDictionaryBoundaryLines)
    : wordingLines

  return {
    lines,
    boundaryLines: markdown.lines,
    structuralLines,
    structuralBoundaryLines: markdown.structuralLines,
    wordingLines,
    wordingBoundaryLines,
    wordingDictionaryLines,
    wordingDictionaryBoundaryLines,
    wordingStructuralLines,
    structuralBlanks: markdown.structuralBlanks,
    wordingStructuralBlanks: markdown.wordingStructuralBlanks,
    sentenceBoundaryLines: markdown.sentenceBoundaryLines,
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
      sourceOffset + (offsets[endLine - 1] ?? startOffset) + (lines[endLine - 1]?.length ?? 0),
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
  const sentences = segmentSentences(
    prepared.lines,
    sourceText,
    prepared.structuralBlanks,
    prepared.boundaryLines,
    prepared.sentenceBoundaryLines,
  )
  const paragraphs = segmentParagraphs(
    prepared.structuralLines.map((line, index) => line.slice(contentStarts[index] ?? 0)),
    contentStarts.map((contentStart) => contentStart + 1),
    prepared.structuralBoundaryLines.map((line, index) => line.slice(contentStarts[index] ?? 0)),
  )
  const offsets = lineOffsets(prepared.structuralLines)
  const sentenceIndex = indexSentenceScopes(sentences, prepared.lines.length, sourceOffset)
  const wordingSentenceIndex = options.exemptBlockQuotes
    ? indexSentenceScopes(
        segmentSentences(
          prepared.wordingLines,
          prepared.wordingLines.join("\n"),
          prepared.wordingStructuralBlanks,
          prepared.wordingBoundaryLines,
          prepared.sentenceBoundaryLines,
        ),
        prepared.wordingLines.length,
        sourceOffset,
      )
    : sentenceIndex
  const approvedWordMode = isApprovedWordMode(options.dictionary)
  const dictionarySentenceIndex = approvedWordMode
    ? indexSentenceScopes(
        segmentSentences(
          prepared.wordingDictionaryLines,
          prepared.wordingDictionaryLines.join("\n"),
          prepared.wordingStructuralBlanks,
          prepared.wordingDictionaryBoundaryLines,
          prepared.sentenceBoundaryLines,
        ),
        prepared.wordingDictionaryLines.length,
        sourceOffset,
      )
    : wordingSentenceIndex
  const sentenceFindings = (
    violations: readonly Violation[],
    findingSentenceIndex: SentenceScopeIndex = sentenceIndex,
    findingLines: readonly string[] = prepared.structuralLines,
  ): ScopedViolation[] =>
    violations.map((violation) => {
      const scope = scopeForViolation(
        violation,
        findingSentenceIndex,
        findingLines,
        offsets,
        sourceOffset,
      )
      return {
        violation,
        scope,
        sentenceIdentity: scope.identity,
        occurrenceOffset: sourceOffset + (offsets[violation.line - 1] ?? 0) + violation.column - 1,
      }
    })
  const wordingFindings = (violations: readonly Violation[]): ScopedViolation[] =>
    sentenceFindings(
      violations,
      wordingSentenceIndex,
      options.exemptBlockQuotes ? prepared.wordingLines : prepared.structuralLines,
    )

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
    ...wordingFindings(contraction(prepared.wordingLines)),
    ...sentenceFindings(semicolon(prepared.lines)),
    ...(options.ruleData?.["phrasal-verb"] === undefined
      ? []
      : wordingFindings(phrasalVerb(prepared.wordingLines, options.ruleData["phrasal-verb"]))),
    ...(options.ruleData?.hedging === undefined
      ? []
      : wordingFindings(hedging(prepared.wordingLines, options.ruleData.hedging))),
    ...(options.ruleData?.marketing === undefined
      ? []
      : wordingFindings(marketing(prepared.wordingLines, options.ruleData.marketing))),
    ...(options.dictionary === undefined
      ? []
      : sentenceFindings(
          dictionaryRule(
            prepared.wordingStructuralLines,
            options.dictionary,
            options.tagger,
            contentStarts,
            prepared.wordingDictionaryLines,
          ),
          dictionarySentenceIndex,
          approvedWordMode ? prepared.wordingDictionaryLines : prepared.wordingStructuralLines,
        )),
    ...(options.tagger === undefined
      ? []
      : sentenceFindings(
          verbForm(prepared.lines, options.tagger, options.ruleData?.["adjectival-participle"]),
        )),
  ]
}

const lintExtracted = (extracted: ProseRun, options: ResolvedOptions): ScopedViolation[] =>
  lintProse(
    prepareProse(extracted, isApprovedWordMode(options.dictionary), options.exemptBlockQuotes),
    extracted.contentStarts,
    extracted.sourceOffset,
    options,
  )

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
  resolved: ResolvedOptions,
): ScopedViolation[] {
  const extractedText = extract(kind, text, options)
  const suppressions = analyzeSuppressions(kind, text, extractedText.lineComments)
  const extracted = blankDirectiveRanges(extractedText, suppressions.directiveRanges)
  const proseFindings = splitProseRuns(extracted).flatMap((run) =>
    lintExtracted(run, resolved).map((finding) => ({
      ...finding,
      violation: {
        ...finding.violation,
        line: finding.violation.line + run.lineOffset,
        column:
          finding.violation.column + (finding.violation.line === 1 ? run.firstColumnOffset : 0),
      },
    })),
  )

  return [...proseFindings, ...suppressions.invalidFindings]
    .filter(
      (finding) =>
        !suppressions.ruleIdsByTargetLine
          .get(finding.violation.line)
          ?.has(finding.violation.ruleId),
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

export function lint(kind: LintKind, text: string, options: LintOptions = {}): LintReport {
  const resolved: ResolvedOptions = {
    maxSentenceWords: options.maxSentenceWords ?? DEFAULT_MAX_SENTENCE_WORDS,
    exemptBlockQuotes: options.exemptBlockQuotes ?? false,
    dictionary:
      options.dictionary === undefined ? undefined : compileDictionary(options.dictionary),
    ruleData: options.ruleData ?? BUNDLED_RULE_DATA,
    tagger: options.tagger,
  }
  const current = evaluate(kind, text, options, resolved)
  const findings =
    options.previousText === undefined
      ? current
      : newFindings(
          evaluate(kind, options.previousText, options, resolved),
          current,
          changedText(options.previousText, text).retained,
        )
  const violations = findings.map(({ scope, violation }) => ({
    ...violation,
    snippet: text.slice(scope.startOffset, scope.endOffset),
  }))
  return {
    violations,
    summary: {
      total: violations.length,
      hard: violations.filter((violation) => violation.severity === "hard").length,
    },
  }
}
