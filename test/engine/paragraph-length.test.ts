import { describe, expect, test } from "vitest"
import { lint } from "../../src/engine/lint.ts"

const idsFor = (text: string) => lint("prose-file", text).violations.map((v) => v.ruleId)

describe("lint prose-file: paragraph-length rule", () => {
  test("flags a paragraph over 6 sentences as a hard violation", () => {
    const report = lint("prose-file", "One. Two. Three. Four. Five. Six. Seven.")

    const violation = report.violations.find((v) => v.ruleId === "paragraph-length")
    expect(violation).toMatchObject({
      ruleId: "paragraph-length",
      severity: "hard",
      line: 1,
      column: 1,
    })
    expect(violation?.message).toContain("7")
    expect(violation?.message).toContain("6")
  })

  test("does not flag a paragraph of exactly 6 sentences", () => {
    expect(idsFor("One. Two. Three. Four. Five. Six.")).not.toContain("paragraph-length")
  })

  test("flags a paragraph of quoted sentences", () => {
    const text = '"One." "Two." “Three.” ‘Four.’ "Five?" “Six!” "Seven."'

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test("flags sentences before closing Markdown delimiters", () => {
    const text = "*One.* **Two.** _Three._ ~~Four.~~ `Five.` **Six!** _Seven?_"

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test("flags sentences in Markdown links and references", () => {
    const text =
      '[One.](one) [Two.][two] [Three.][] [Four.](four "title") [Five.](<five>) [Six!](six_(nested)) [Seven?][seven]'

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test("flags sentences with post-terminator Markdown references", () => {
    const text = "One.[^1] Two.[two] Three.[^3] Four.[four] Five.[^5] Six.[six] Seven.[^7]"

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test("a blank line ends a paragraph", () => {
    expect(idsFor("One. Two. Three. Four.\n\nFive. Six. Seven. Eight.")).not.toContain(
      "paragraph-length",
    )
  })

  test("a bullet list is not one long paragraph", () => {
    const text = "- One. Two.\n- Three. Four.\n- Five. Six.\n- Seven. Eight.\n- Nine. Ten."

    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test("a numbered list is not one long paragraph", () => {
    const text = "1. One. Two.\n2. Three. Four.\n3. Five. Six.\n4. Seven. Eight."

    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test("a table is not a paragraph", () => {
    const text = [
      "| Rule | Severity |",
      "| --- | --- |",
      "| one. | hard. |",
      "| two. | soft. |",
      "| three. | hard. |",
      "| four. | soft. |",
      "| five. | hard. |",
    ].join("\n")

    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test("a heading ends a paragraph", () => {
    const text = "One. Two. Three.\n## A heading\nFour. Five. Six. Seven."

    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test("still flags a long prose paragraph that spans hard-wrapped lines", () => {
    const text = "One. Two. Three. Four.\nFive. Six. Seven. Eight. Nine."
    const report = lint("prose-file", text)

    const violation = report.violations.find((v) => v.ruleId === "paragraph-length")
    expect(violation).toMatchObject({ severity: "hard", line: 1, column: 1 })
    expect(violation?.message).toContain("9")
  })

  test("reports the line where the paragraph starts", () => {
    const text = "A short opener.\n\nOne. Two. Three. Four. Five. Six. Seven."
    const report = lint("prose-file", text)

    const violation = report.violations.find((v) => v.ruleId === "paragraph-length")
    expect(violation).toMatchObject({ line: 3, column: 1 })
  })
})
