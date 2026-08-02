import { describe, expect, test } from "vitest"
import type { Dictionary } from "../../src/dictionary/schema.ts"
import { lint } from "../../src/engine/lint.ts"

const idsFor = (text: string) => lint("prose-file", text).violations.map((v) => v.ruleId)

describe("lint prose-file: hedging rule", () => {
  test("flags a hedge phrase as a soft violation", () => {
    const report = lint("prose-file", "It is important to note that the lock is held.")

    const violation = report.violations.find((v) => v.ruleId === "hedging")
    expect(violation).toMatchObject({
      ruleId: "hedging",
      severity: "soft",
      line: 1,
      column: 1,
    })
    expect(violation?.message.toLowerCase()).toContain("it is important to note")
  })

  test("flags listed hedge phrases regardless of case", () => {
    for (const text of [
      "it should be noted that the pump runs.",
      "Please note that the valve is open.",
      "This is worth doing, as mentioned.",
    ]) {
      expect(idsFor(text), text).toContain("hedging")
    }
  })

  test("soft hedging violations do not count as hard in the summary", () => {
    const report = lint("prose-file", "It is worth noting that the pump runs.")

    expect(report.summary.total).toBe(1)
    expect(report.summary.hard).toBe(0)
  })

  test.each([
    "The text says as mentioned-above.",
    "Do not use as mentioned's wording.",
    "Do not use as mentioned’s wording.",
  ])("does not match within a token in %s", (text) => {
    expect(idsFor(text)).not.toContain("hedging")
  })

  test("returns no violations for an empty dictionary", () => {
    const emptyDictionary = {
      formatVersion: 1,
      source: {
        name: "empty test dictionary",
        repository: "https://example.test/rule-data",
        commit: "fixture",
        path: "hedging.json",
      },
      entries: [],
    } as const satisfies Dictionary

    const report = lint("prose-file", "Plain text.", {
      ruleData: { hedging: emptyDictionary },
    })

    expect(report.violations).toEqual([])
  })

  test("does not flag plain prose that mentions notes", () => {
    expect(idsFor("Write a note in the log.")).not.toContain("hedging")
  })
})
