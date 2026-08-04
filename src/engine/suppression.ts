import type { LineCommentSpan } from "./comments.ts"
import type { ScopedViolation } from "./diff-match.ts"
import { markdownHtmlComments } from "./markdown.ts"
import { type RuleId, ruleIds } from "./rules/registry.ts"
import type { LintKind } from "./types.ts"

export interface SuppressionRange {
  readonly line: number
  readonly startColumn: number
  readonly endColumn: number
}

interface SuppressionDirective extends SuppressionRange {
  readonly column: number
  readonly ruleIds: readonly RuleId[]
  readonly unknownRuleIds: readonly string[]
}

export interface SuppressionAnalysis {
  readonly directiveRanges: readonly SuppressionRange[]
  readonly ruleIdsByTargetLine: ReadonlyMap<number, ReadonlySet<RuleId>>
  readonly invalidFindings: readonly ScopedViolation[]
}

interface DirectiveCandidate extends SuppressionRange {
  readonly column: number
  readonly names: string
}

const registeredRuleIds: ReadonlySet<string> = new Set(ruleIds)
const sourceDirective = /^\s*ste-disable-next-line(?:\s+(.*?))?\s*$/u
const markdownDirective = /^<!--\s*ste-disable-next-line(?:\s+(.*?))?\s*-->$/u

const unique = <Value>(values: readonly Value[]): readonly Value[] => [...new Set(values)]

const sourceCandidates = (
  lines: readonly string[],
  lineComments: readonly LineCommentSpan[],
): readonly DirectiveCandidate[] =>
  lineComments.flatMap((comment) => {
    const match = lines[comment.line - 1]
      ?.slice(comment.contentStart, comment.endColumn)
      .match(sourceDirective)
    if (match === null || match === undefined) return []

    return [
      {
        line: comment.line,
        column: comment.markerStart + 1,
        startColumn: comment.contentStart,
        endColumn: comment.endColumn,
        names: match[1] ?? "",
      },
    ]
  })

const markdownCandidates = (text: string): readonly DirectiveCandidate[] =>
  markdownHtmlComments(text).flatMap((comment) => {
    const match = comment.text.match(markdownDirective)
    if (match === null) return []

    return [
      {
        line: comment.line,
        column: comment.startColumn + 1,
        startColumn: comment.startColumn,
        endColumn: comment.endColumn,
        names: match[1] ?? "",
      },
    ]
  })

const parseDirective = (candidate: DirectiveCandidate): SuppressionDirective => {
  const names = unique(candidate.names.split(/[\s,]+/u).filter((name) => name !== ""))
  return {
    ...candidate,
    ruleIds: names.filter((name): name is RuleId => registeredRuleIds.has(name)),
    unknownRuleIds: names.filter((name) => !registeredRuleIds.has(name)),
  }
}

const offsetsForLines = (lines: readonly string[]): readonly number[] => {
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }
  return offsets
}

const invalidFinding = (
  directive: SuppressionDirective,
  line: string,
  lineOffset: number,
): ScopedViolation | undefined => {
  const message =
    directive.unknownRuleIds.length > 0
      ? `Suppression directive names unknown rule ids: ${directive.unknownRuleIds.map((id) => `"${id}"`).join(", ")}.`
      : directive.ruleIds.length === 0
        ? "Suppression directive must name at least one rule id."
        : undefined
  if (message === undefined) return undefined

  const directiveStart = directive.column - 1
  const identity = line.slice(directiveStart, directive.endColumn).replace(/\s+/gu, " ").trim()
  return {
    violation: {
      ruleId: "invalid-suppression",
      severity: "hard",
      message,
      line: directive.line,
      column: directive.column,
    },
    scope: {
      kind: "sentence",
      identity,
      startOffset: lineOffset + directiveStart,
      endOffset: lineOffset + directive.endColumn,
    },
    sentenceIdentity: identity,
    occurrenceOffset: lineOffset + directiveStart,
  }
}

export function analyzeSuppressions(
  kind: LintKind,
  text: string,
  lineComments: readonly LineCommentSpan[],
): SuppressionAnalysis {
  if (!text.includes("ste-disable-next-line")) {
    return {
      directiveRanges: [],
      ruleIdsByTargetLine: new Map(),
      invalidFindings: [],
    }
  }

  const lines = text.split("\n")
  const candidates =
    kind === "prose-file"
      ? markdownCandidates(text)
      : kind === "slash-source" || kind === "hash-source"
        ? sourceCandidates(lines, lineComments)
        : []
  const directives = candidates.map(parseDirective)
  const offsets = offsetsForLines(lines)
  const ruleIdsByTargetLine = new Map<number, Set<RuleId>>()
  const invalidFindings: ScopedViolation[] = []

  for (const directive of directives) {
    const targetLine = directive.line + 1
    const targetRuleIds = ruleIdsByTargetLine.get(targetLine) ?? new Set<RuleId>()
    for (const ruleId of directive.ruleIds) targetRuleIds.add(ruleId)
    ruleIdsByTargetLine.set(targetLine, targetRuleIds)

    const finding = invalidFinding(
      directive,
      lines[directive.line - 1] ?? "",
      offsets[directive.line - 1] ?? 0,
    )
    if (finding !== undefined) invalidFindings.push(finding)
  }

  return {
    directiveRanges: directives.map(({ line, startColumn, endColumn }) => ({
      line,
      startColumn,
      endColumn,
    })),
    ruleIdsByTargetLine,
    invalidFindings,
  }
}
