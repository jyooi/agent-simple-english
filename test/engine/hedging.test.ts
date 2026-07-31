import { describe, expect, test } from "vitest"
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

  test("does not flag plain prose that mentions notes", () => {
    expect(idsFor("Write a note in the log.")).not.toContain("hedging")
  })
})
