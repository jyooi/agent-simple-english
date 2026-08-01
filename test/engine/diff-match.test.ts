import { describe, expect, test } from "vitest"
import {
  type ScopedViolation,
  type ViolationScope,
  newFindings,
} from "../../src/engine/diff-match.ts"
import type { RetainedRange } from "../../src/engine/diff.ts"
import type { RuleId } from "../../src/engine/rules/registry.ts"

const scope = (startOffset: number, endOffset: number, identity = "scope"): ViolationScope => ({
  kind: "sentence",
  identity,
  startOffset,
  endOffset,
})

const finding = (
  findingScope: ViolationScope,
  options: {
    readonly ruleId?: RuleId
    readonly sentenceIdentity?: string
    readonly occurrenceOffset?: number
  } = {},
): ScopedViolation => ({
  violation: {
    ruleId: options.ruleId ?? "sentence-length",
    severity: "hard",
    message: "Test violation.",
    line: 1,
    column: 1,
  },
  scope: findingScope,
  ...options,
})

const match = (
  previous: readonly ScopedViolation[],
  current: readonly ScopedViolation[],
  retained: readonly RetainedRange[],
) => newFindings(previous, current, retained)

describe("diff finding matcher", () => {
  test("retains a scope after an unrelated edit", () => {
    const previous = finding(scope(0, 10), {
      sentenceIdentity: "same sentence",
      occurrenceOffset: 4,
    })
    const current = finding(scope(0, 10), {
      sentenceIdentity: "same sentence",
      occurrenceOffset: 4,
    })

    expect(
      match([previous], [current], [{ previousStart: 0, currentStart: 0, length: 10 }]),
    ).toEqual([])
  })

  test("retains a scope that an edit changes", () => {
    const previous = finding(scope(0, 10, "old scope"))
    const current = finding(scope(0, 11, "new scope"))
    const retained = [
      { previousStart: 0, currentStart: 0, length: 4 },
      { previousStart: 5, currentStart: 6, length: 5 },
    ]

    expect(match([previous], [current], retained)).toEqual([])
  })

  test("skips a removed scope and matches the retained scope", () => {
    const removed = finding(scope(0, 5))
    const previous = finding(scope(6, 11))
    const current = finding(scope(0, 5))

    expect(
      match([removed, previous], [current], [{ previousStart: 6, currentStart: 0, length: 5 }]),
    ).toEqual([])
  })

  test("reports scopes that split", () => {
    const previous = finding(scope(0, 10))
    const first = finding(scope(0, 5))
    const second = finding(scope(5, 10))

    expect(
      match([previous], [first, second], [{ previousStart: 0, currentStart: 0, length: 10 }]),
    ).toEqual([first, second])
  })

  test("reports scopes that merge", () => {
    const first = finding(scope(0, 5))
    const second = finding(scope(5, 10))
    const current = finding(scope(0, 10))

    expect(
      match([first, second], [current], [{ previousStart: 0, currentStart: 0, length: 10 }]),
    ).toEqual([current])
  })

  test("maps scope and finding position drift", () => {
    const previous = finding(scope(5, 15), {
      sentenceIdentity: "same sentence",
      occurrenceOffset: 8,
    })
    const current = finding(scope(9, 19), {
      sentenceIdentity: "same sentence",
      occurrenceOffset: 12,
    })

    expect(
      match(
        [previous],
        [current],
        [
          { previousStart: 0, currentStart: 0, length: 5 },
          { previousStart: 5, currentStart: 9, length: 10 },
        ],
      ),
    ).toEqual([])
  })

  test("reports a new rule occurrence in a retained sentence", () => {
    const previous = finding(scope(0, 10), {
      ruleId: "semicolon",
      sentenceIdentity: "same sentence",
      occurrenceOffset: 4,
    })
    const retained = finding(scope(0, 11), {
      ruleId: "semicolon",
      sentenceIdentity: "same sentence",
      occurrenceOffset: 4,
    })
    const added = finding(scope(0, 11), {
      ruleId: "semicolon",
      sentenceIdentity: "same sentence",
      occurrenceOffset: 5,
    })

    expect(
      match(
        [previous],
        [retained, added],
        [
          { previousStart: 0, currentStart: 0, length: 5 },
          { previousStart: 5, currentStart: 6, length: 5 },
        ],
      ),
    ).toEqual([added])
  })
})
