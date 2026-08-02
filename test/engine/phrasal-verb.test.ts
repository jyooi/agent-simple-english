import { describe, expect, test } from "vitest"
import type { Dictionary } from "../../src/dictionary/schema.ts"
import { lint } from "../../src/engine/lint.ts"

const idsFor = (text: string) => lint("prose-file", text).violations.map((v) => v.ruleId)

describe("lint prose-file: phrasal-verb rule", () => {
  test("flags a phrasal verb as a hard violation with the approved alternative", () => {
    const report = lint("prose-file", "Carry out the test.")

    const violation = report.violations.find((v) => v.ruleId === "phrasal-verb")
    expect(violation).toMatchObject({
      ruleId: "phrasal-verb",
      severity: "hard",
      line: 1,
      column: 1,
      suggestion: "do",
    })
    expect(violation?.message).toContain('"do"')
    expect(violation?.message.toLowerCase()).toContain("carry out")
  })

  test("flags conjugated forms", () => {
    for (const text of [
      "The runner carries out the job.",
      "We carried out the check.",
      "We spun down the cluster.",
      "They dove into the logs.",
    ]) {
      expect(idsFor(text), text).toContain("phrasal-verb")
    }
  })

  test("suggests the single-verb alternative for each listed phrasal verb", () => {
    const cases: readonly [string, string][] = [
      ["Spin up the worker.", "start"],
      ["Tear down the stack.", "remove"],
      ["Reach out to the team.", "ask"],
      ["Roll out the change.", "release"],
      ["Ramp up the load.", "increase"],
      ["Circle back tomorrow.", "return"],
    ]
    for (const [text, suggestion] of cases) {
      const report = lint("prose-file", text)
      const violation = report.violations.find((v) => v.ruleId === "phrasal-verb")
      expect(violation?.suggestion, text).toBe(suggestion)
    }
  })

  test("deduplicates repeated extension entries", () => {
    const extension = {
      formatVersion: 1,
      source: {
        name: "test extension",
        repository: "https://example.test/rule-data",
        commit: "fixture",
        path: "phrasal-verbs.json",
      },
      entries: [
        { unapproved: ["carry out"], suggestions: ["do"] },
        { unapproved: ["carry out"], suggestions: ["do"] },
      ],
    } as const satisfies Dictionary

    const report = lint("prose-file", "Carry out the test.", {
      ruleData: { "phrasal-verb": extension },
    })

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "phrasal-verb", suggestion: "do" }),
    ])
  })

  test("reports the column where the phrasal verb starts", () => {
    const report = lint("prose-file", "Please spin up the worker.")

    const violation = report.violations.find((v) => v.ruleId === "phrasal-verb")
    expect(violation).toMatchObject({ line: 1, column: 8 })
  })

  test.each([
    "The channel carries out-of-band data.",
    "Do not confuse carry out's spelling.",
    "Do not confuse carry out’s spelling.",
  ])("does not match within a token in %s", (text) => {
    expect(idsFor(text)).not.toContain("phrasal-verb")
  })

  test("does not flag the bare verb without its particle", () => {
    expect(idsFor("We spin the wheel. Carry the box.")).not.toContain("phrasal-verb")
  })

  test("does not flag unrelated words that contain a listed verb", () => {
    expect(idsFor("The spinner works. The carrier is here.")).not.toContain("phrasal-verb")
  })
})
