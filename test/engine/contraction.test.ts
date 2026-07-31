import { describe, expect, test } from "vitest"
import { lint } from "../../src/engine/lint.ts"

const idsFor = (text: string) => lint("prose-file", text).violations.map((v) => v.ruleId)

describe("lint prose-file: contraction rule", () => {
  test("flags a contraction as a hard violation with its position", () => {
    const report = lint("prose-file", "The lock isn't held.")

    const violation = report.violations.find((v) => v.ruleId === "contraction")
    expect(violation).toMatchObject({
      ruleId: "contraction",
      severity: "hard",
      line: 1,
      column: 10,
    })
    expect(violation?.message).toContain("isn't")
  })

  test("flags an apostrophe-s contraction", () => {
    expect(idsFor("It's ready now.")).toContain("contraction")
  })

  test("does not flag a possessive", () => {
    expect(idsFor("Check the repo's own docs and Cameron's notes.")).not.toContain("contraction")
  })

  test("flags every unambiguous contraction form", () => {
    for (const form of ["don't", "we're", "we've", "we'll", "we'd", "I'm"]) {
      expect(idsFor(`Now ${form} here.`), form).toContain("contraction")
    }
  })

  test("flags a typographic apostrophe", () => {
    expect(idsFor("The lock isn’t held.")).toContain("contraction")
  })

  test("does not flag plain prose", () => {
    expect(idsFor("Do not remove the bolt.")).not.toContain("contraction")
  })

  test("ignores contractions inside inline code", () => {
    expect(idsFor("Use `don't` here.")).not.toContain("contraction")
  })
})
