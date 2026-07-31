import { describe, expect, test } from "vitest"
import { lint } from "../../src/engine/lint.ts"

const idsFor = (text: string) => lint("prose-file", text).violations.map((v) => v.ruleId)

describe("lint prose-file: semicolon rule", () => {
  test("flags a semicolon as a hard violation at its column", () => {
    const report = lint("prose-file", "Start the job; then stop it.")

    const violation = report.violations.find((v) => v.ruleId === "semicolon")
    expect(violation).toMatchObject({
      ruleId: "semicolon",
      severity: "hard",
      line: 1,
      column: 14,
    })
  })

  test("flags each semicolon separately", () => {
    const report = lint("prose-file", "One; two; three.")

    const violations = report.violations.filter((v) => v.ruleId === "semicolon")
    expect(violations).toHaveLength(2)
    expect(violations.map((v) => v.column)).toEqual([4, 9])
  })

  test("does not flag text without semicolons", () => {
    expect(idsFor("Start the job. Then stop it.")).not.toContain("semicolon")
  })

  test("flags semicolons inside inline code", () => {
    const report = lint("prose-file", "Use `const value = 1;` here.")

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "semicolon", line: 1, column: 21 }),
    ])
  })

  test("ignores semicolons inside fenced code blocks", () => {
    const text = "A sentence.\n```ts\nconst x = 1;\n```\nAnother sentence."

    expect(idsFor(text)).not.toContain("semicolon")
  })
})
