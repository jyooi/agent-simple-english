import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { lint } from "../../src/engine/lint.ts"

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8")

describe("lint prose-file: diff-only linting via previousText", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i + 1}`).join(" ")

  test("a new document (no previousText) is linted in full", () => {
    const text = `${words(26)}.\n\n${words(27)}.`

    expect(lint("prose-file", text).violations).toHaveLength(2)
  })

  test("an unchanged document reports no violations even when it contains some", () => {
    const text = `${words(30)}.`

    expect(lint("prose-file", text, { previousText: text }).violations).toHaveLength(0)
  })

  test("an empty previousText means every line is new, so the full text is linted", () => {
    const report = lint("prose-file", `${words(30)}.`, { previousText: "" })

    expect(report.violations).toHaveLength(1)
  })

  test("editing one paragraph of a file full of violations reports only the touched region", () => {
    const report = lint("prose-file", fixture("edit-current.md"), {
      previousText: fixture("edit-previous.md"),
    })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({
      ruleId: "sentence-length",
      severity: "hard",
      line: 5,
      column: 1,
    })
    expect(report.summary).toEqual({ total: 1, hard: 1 })
  })

  test("an insertion that pushes an existing sentence over the word cap is reported", () => {
    const previous = `${words(20)}.`
    const current = `extra extra extra extra extra extra ${words(20)}.`
    const report = lint("prose-file", current, { previousText: previous })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 1, column: 1 })
  })

  test("editing a later line of a multi-line sentence flags the sentence at its start", () => {
    const previous = `${words(13)}\n${words(11)}.`
    const current = `${words(13)}\n${words(11)} plus two.`
    const report = lint("prose-file", current, { previousText: previous })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 1, column: 1 })
  })

  test("deleting text never produces violations for the removed content", () => {
    const previous = `${words(30)}.\n\nA short closing sentence.`
    const current = "A short closing sentence."

    expect(lint("prose-file", current, { previousText: previous }).violations).toHaveLength(0)
  })

  test("deleting one paragraph does not surface untouched pre-existing violations", () => {
    const previous = `${words(30)}.\n\n${words(28)}.`
    const current = `${words(28)}.`

    expect(lint("prose-file", current, { previousText: previous }).violations).toHaveLength(0)
  })

  test("deleting a terminator line that merges retained fragments lints the merged sentence", () => {
    const previous = `${words(13)}\nEnds here.\n${words(13)} done.`
    const current = `${words(13)}\n${words(13)} done.`
    const report = lint("prose-file", current, { previousText: previous })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({
      ruleId: "sentence-length",
      line: 1,
      column: 1,
    })
  })

  test("edits past the DP size bound conservatively treat the whole middle as changed", () => {
    const previous = Array.from({ length: 1001 }, (_, i) => `Old line ${i}.`).join("\n")
    const current = Array.from({ length: 1001 }, (_, i) =>
      i === 0 || i === 500 || i === 1000 ? `${words(26)} tail${i}.` : `New line ${i}.`,
    ).join("\n")
    const report = lint("prose-file", current, { previousText: previous })

    expect(report.violations.map((violation) => violation.line)).toEqual([1, 501, 1001])
  })

  test("positions refer to the new text when an insertion shifts pre-existing prose", () => {
    const previous = `Intro.\n\n${words(30)}.`
    const current = `Intro.\n\n${words(28)} inserted.\n\n${words(30)}.`
    const report = lint("prose-file", current, { previousText: previous })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 3, column: 1 })
  })
})
