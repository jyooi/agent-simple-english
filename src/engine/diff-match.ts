import type { RetainedRange } from "./diff.ts"
import type { Violation } from "./types.ts"

export interface ViolationScope {
  readonly kind: "sentence" | "paragraph"
  readonly identity: string
  readonly startOffset: number
  readonly endOffset: number
}

export interface ScopedViolation {
  readonly violation: Violation
  readonly scope: ViolationScope
  readonly sentenceIdentity?: string
  readonly occurrenceOffset?: number
}

interface FindingSearchIndex {
  readonly candidates: ScopedViolation[]
  cursor: number
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

export function newFindings(
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
