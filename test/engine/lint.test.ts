import { describe, expect, expectTypeOf, test } from "vitest"
import { lint } from "../../src/engine/lint.ts"
import type { RuleId } from "../../src/engine/rules/registry.ts"
import type { LintOptions, RuleSetting, Violation } from "../../src/engine/types.ts"

describe("lint prose-file: sentence-length rule", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i + 1}`).join(" ")

  test("flags a sentence over 25 words as a hard violation", () => {
    const report = lint("prose-file", `${words(26)}.`)

    expect(report.violations).toHaveLength(1)
    const violation = report.violations[0]
    expect(violation).toMatchObject({
      ruleId: "sentence-length",
      severity: "hard",
      line: 1,
      column: 1,
    })
    expect(violation?.message).toContain("26")
    expect(violation?.message).toContain("25")
  })

  test("does not flag a sentence of exactly 25 words", () => {
    const report = lint("prose-file", `${words(25)}.`)

    expect(report.violations).toHaveLength(0)
  })

  test("does not flag short sentences", () => {
    const report = lint("prose-file", "Remove the bolt. Turn the handle to the left.")

    expect(report.violations).toHaveLength(0)
  })

  test("returns no violations for empty input", () => {
    expect(lint("prose-file", "").violations).toHaveLength(0)
    expect(lint("prose-file", "   \n\n  ").violations).toHaveLength(0)
  })

  test("word cap is configurable via options", () => {
    const text = `${words(10)}.`

    expect(lint("prose-file", text, { maxSentenceWords: 9 }).violations).toHaveLength(1)
    expect(lint("prose-file", text, { maxSentenceWords: 10 }).violations).toHaveLength(0)
  })

  test("reports the line and column where the long sentence starts", () => {
    const text = `Short sentence here.\n\nAnother short one. ${words(30)}.`
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 3, column: 20 })
  })

  test("counts a sentence that spans multiple lines once, at its start", () => {
    const text = `${words(13)}\n${words(13)}.`
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 1, column: 1 })
  })

  test("ignores fenced code blocks", () => {
    const text = [
      "A short sentence.",
      "```ts",
      `const x = "${words(40)}"`,
      "```",
      "Another short sentence.",
    ].join("\n")

    expect(lint("prose-file", text).violations).toHaveLength(0)
  })

  test("still flags prose after a fenced code block, with correct position", () => {
    const text = ["```", words(40), "```", `${words(30)}.`].join("\n")
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 4, column: 1 })
  })

  test("per-rule override to soft downgrades the violation and the hard count", () => {
    const report = lint("prose-file", `${words(26)}.`, {
      rules: { "sentence-length": "soft" },
    })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]?.severity).toBe("soft")
    expect(report.summary).toEqual({ total: 1, hard: 0 })
  })

  test("per-rule override to off suppresses the rule entirely", () => {
    const report = lint("prose-file", `${words(26)}.`, {
      rules: { "sentence-length": "off" },
    })

    expect(report.violations).toHaveLength(0)
    expect(report.summary).toEqual({ total: 0, hard: 0 })
  })

  test("per-rule override to hard keeps the violation hard", () => {
    const report = lint("prose-file", `${words(26)}.`, {
      rules: { "sentence-length": "hard" },
    })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]?.severity).toBe("hard")
    expect(report.summary).toEqual({ total: 1, hard: 1 })
  })

  test("engine types are keyed by registry-derived rule IDs", () => {
    expectTypeOf<Violation["ruleId"]>().toEqualTypeOf<RuleId>()
    expectTypeOf<LintOptions["rules"]>().toEqualTypeOf<
      Partial<Record<RuleId, RuleSetting>> | undefined
    >()
  })

  test("summary counts total and hard violations", () => {
    const text = `${words(26)}. ${words(27)}.`
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(2)
    expect(report.summary).toEqual({ total: 2, hard: 2 })
  })
})
