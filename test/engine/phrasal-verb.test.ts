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

  test("deduplicates case and whitespace variants of extension entries", () => {
    const extension = {
      formatVersion: 1,
      source: {
        name: "test extension",
        repository: "https://example.test/rule-data",
        commit: "fixture",
        path: "phrasal-verbs.json",
      },
      entries: [
        { unapproved: ["Carry\tout"], suggestions: ["do"] },
        { unapproved: ["carry out"], suggestions: ["do"] },
      ],
    } as const satisfies Dictionary

    const report = lint("prose-file", "CARRY   OUT the test.", {
      ruleData: { "phrasal-verb": extension },
    })

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "phrasal-verb", suggestion: "do" }),
    ])
  })

  test("accepts every ECMAScript same-line whitespace separator", () => {
    const separators = [
      "\t",
      "\v",
      "\f",
      " ",
      "\u00a0",
      "\u1680",
      "\u2000",
      "\u2001",
      "\u2002",
      "\u2003",
      "\u2004",
      "\u2005",
      "\u2006",
      "\u2007",
      "\u2008",
      "\u2009",
      "\u200a",
      "\u202f",
      "\u205f",
      "\u3000",
      "\ufeff",
    ]

    for (const separator of separators) {
      expect(idsFor(`Carry${separator}out the test.`), separator.codePointAt(0)?.toString(16)).toContain(
        "phrasal-verb",
      )
    }
  })

  test.each(["\n", "\r", "\u2028", "\u2029"])(
    "does not match across line terminator U+%s",
    (separator) => {
      expect(idsFor(`Carry${separator}out the test.`)).not.toContain("phrasal-verb")
    },
  )

  test("case-folds Unicode extension forms without changing source offsets", () => {
    const extension = {
      formatVersion: 1,
      source: {
        name: "test extension",
        repository: "https://example.test/rule-data",
        commit: "fixture",
        path: "phrasal-verbs.json",
      },
      entries: [{ unapproved: ["straße aus"], suggestions: ["leave"] }],
    } as const satisfies Dictionary

    const report = lint("prose-file", "İ STRASSE AUS now.", {
      ruleData: { "phrasal-verb": extension },
    })

    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: "phrasal-verb",
        line: 1,
        column: 3,
        suggestion: "leave",
      }),
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
