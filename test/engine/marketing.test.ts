import { describe, expect, test } from "vitest"
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

  test("flags hyphenated marketing compounds", () => {
    for (const text of [
      "A state-of-the-art design.",
      "The cutting-edge pipeline runs.",
      "Our enterprise-grade stack.",
    ]) {
      expect(idsFor(text), text).toContain("marketing")
    }
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
