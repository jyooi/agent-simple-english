import { describe, expect, test } from "vitest"
import type { Dictionary } from "../../src/dictionary/schema.ts"
import { lint } from "../../src/engine/lint.ts"

const idsFor = (text: string) => lint("prose-file", text).violations.map((v) => v.ruleId)

describe("lint prose-file: marketing rule", () => {
  test("flags a marketing word as a soft violation with its position", () => {
    const report = lint("prose-file", "This is a seamless flow.")

    const violation = report.violations.find((v) => v.ruleId === "marketing")
    expect(violation).toMatchObject({
      ruleId: "marketing",
      severity: "soft",
      line: 1,
      column: 11,
    })
    expect(violation?.message).toContain("seamless")
  })

  test("flags complete hyphenated marketing compounds", () => {
    const report = lint("prose-file", "A state-of-the-art design.")

    const violations = report.violations.filter((v) => v.ruleId === "marketing")
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 1, column: 3 })
    expect(violations[0]?.message).toContain("state-of-the-art")
  })

  test("flags listed words within larger hyphenated tokens", () => {
    const report = lint("prose-file", "An ultra-robust platform.")

    const violation = report.violations.find((v) => v.ruleId === "marketing")
    expect(violation).toMatchObject({ line: 1, column: 10 })
    expect(violation?.message).toContain("robust")
  })

  test.each(["robust-powerful", "robust--powerful"])(
    "flags only the first listed part of the hyphenated token %s",
    (token) => {
      const report = lint("prose-file", `A ${token} platform.`)

      const violations = report.violations.filter((v) => v.ruleId === "marketing")
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({ line: 1, column: 3 })
      expect(violations[0]?.message).toContain("robust")
    },
  )

  test.each(["state-of-the-art--", "--state-of-the-art"])(
    "preserves terminal hyphens in the token %s",
    (token) => {
      expect(idsFor(`A ${token} design.`)).not.toContain("marketing")
    },
  )

  test.each(["Turnkey's interface.", "Turnkey’s interface."])(
    "preserves apostrophes in the token %s",
    (text) => {
      expect(idsFor(text)).not.toContain("marketing")
    },
  )

  test("matches Unicode words from an extension dictionary", () => {
    const extension = {
      formatVersion: 1,
      source: {
        name: "test extension",
        repository: "https://example.test/rule-data",
        commit: "fixture",
        path: "marketing.json",
      },
      entries: [{ unapproved: ["über"], suggestions: ["excellent"] }],
    } as const satisfies Dictionary

    const report = lint("prose-file", "An über platform.", {
      ruleData: { marketing: extension },
    })

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "marketing", line: 1, column: 4 }),
    ])
  })

  test("matches multi-word forms from an extension dictionary", () => {
    const extension = {
      formatVersion: 1,
      source: {
        name: "test extension",
        repository: "https://example.test/rule-data",
        commit: "fixture",
        path: "marketing.json",
      },
      entries: [{ unapproved: ["best in class"], suggestions: ["excellent"] }],
    } as const satisfies Dictionary

    const report = lint("prose-file", "A best in class platform.", {
      ruleData: { marketing: extension },
    })

    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: "marketing",
        line: 1,
        column: 3,
        message: expect.stringContaining("best in class"),
      }),
    ])
  })

  test("matches Unicode case variants with different lowercase forms", () => {
    const extension = {
      formatVersion: 1,
      source: {
        name: "test extension",
        repository: "https://example.test/rule-data",
        commit: "fixture",
        path: "marketing.json",
      },
      entries: [{ unapproved: ["σ"], suggestions: ["plain"] }],
    } as const satisfies Dictionary

    const report = lint("prose-file", "A ς platform.", {
      ruleData: { marketing: extension },
    })

    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: "marketing",
        line: 1,
        column: 3,
        message: expect.stringContaining("ς"),
      }),
    ])
  })

  test("preserves source columns when Unicode lowercase expands", () => {
    const extension = {
      formatVersion: 1,
      source: {
        name: "test extension",
        repository: "https://example.test/rule-data",
        commit: "fixture",
        path: "marketing.json",
      },
      entries: [{ unapproved: ["robust"], suggestions: ["delete"] }],
    } as const satisfies Dictionary

    const report = lint("prose-file", "An İ-robust platform.", {
      ruleData: { marketing: extension },
    })

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "marketing", line: 1, column: 6 }),
    ])
  })

  test("soft marketing violations do not count as hard in the summary", () => {
    const report = lint("prose-file", "A robust and powerful tool.")

    const violations = report.violations.filter((v) => v.ruleId === "marketing")
    expect(violations).toHaveLength(2)
    expect(report.summary.hard).toBe(0)
  })

  test("does not flag words that merely contain a listed word", () => {
    expect(idsFor("The seam is straight. The power supply is on.")).not.toContain("marketing")
  })
})
