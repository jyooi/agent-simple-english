import { describe, expect, test } from "vitest"
import type { Dictionary } from "../../src/dictionary/schema.ts"
import { lint } from "../../src/engine/lint.ts"

const dictionary = {
  formatVersion: 1,
  source: {
    name: "test fixture",
    repository: "https://example.test/dictionary",
    commit: "fixture",
    path: "dictionary.json",
  },
  entries: [{ unapproved: ["attempt"], suggestions: ["try"] }],
} as const satisfies Dictionary

const words = (count: number): string =>
  Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ")

describe("lint prose-file: GFM table masking", () => {
  test("masks a valid multi-row GFM table from all prose rules", () => {
    const text = [
      "Action | State",
      ":--- | ---:",
      "Do not carry out the seamless attempt as mentioned. | It isn't ready.",
      `One. Two. Three. Four. Five. Six. Seven. | ${words(26)}.`,
    ].join("\n")

    expect(lint("prose-file", text, { dictionary }).violations).toEqual([])
  })

  test("lints prose around a table at its original positions", () => {
    const text = [
      "This isn't ready.",
      "",
      "Text | State",
      "--- | ---",
      "It isn't visible. | Ready.",
      "",
      "That isn't ready.",
    ].join("\n")

    expect(lint("prose-file", text).violations).toEqual([
      expect.objectContaining({ ruleId: "contraction", line: 1, column: 6 }),
      expect.objectContaining({ ruleId: "contraction", line: 7, column: 6 }),
    ])
  })

  test("does not mask table-like text with mismatched delimiter cells", () => {
    const text = ["Text | State", "---", "This isn't hidden. | Ready."].join("\n")

    expect(lint("prose-file", text).violations).toEqual([
      expect.objectContaining({ ruleId: "contraction", line: 3, column: 6 }),
    ])
  })

  test("keeps a new table row out of diff-only findings", () => {
    const previousText = ["Text | State", "--- | ---", "Plain text. | Ready."].join("\n")
    const text = `${previousText}\nThis isn't visible. | Ready.`

    expect(lint("prose-file", text, { previousText }).violations).toEqual([])
  })
})
