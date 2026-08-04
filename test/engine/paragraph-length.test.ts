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

  test("counts e.g. and i.e. within four sentences", () => {
    const text =
      "Use the pump, e.g. model two. Check the seal, i.e. the ring. Test it, e.g. daily. Log it, i.e. in full."

    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test.each([
    ["e.g.", "Use the pump, e.g. model two."],
    ["i.e.", "Use the seal, i.e. the outer ring."],
    ["etc.", "Use bolts, etc. for assembly."],
    ["vs.", "Compare model one vs. model two."],
    ["Fig.", "See Fig. 4 for details."],
    ["No.", "Use part No. 7 for assembly."],
    ["a capital initial", "Ask J. Smith for details."],
  ])("does not count %s as a sentence boundary", (_label, sentence) => {
    expect(idsFor(`One. Two. Three. Four. Five. ${sentence}`)).not.toContain("paragraph-length")
  })

  test.each([
    ["list item", "- One. Two. Three. Four. Five. Use e.g. model two."],
    ["block quote", "> One. Two. Three. Four. Five. Use e.g. model two."],
    ["quoted list item", "> - One. Two. Three. Four. Five. Use e.g. model two."],
  ])("does not count abbreviations within a %s", (_label, text) => {
    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test.each([
    ["list item", "- One. Two. Three. Use a model,\n  e.g. model two. Four. Five."],
    [
      "quoted list item",
      "> - One. Two. Three. Use a model,\n>   e.g. model two. Four. Five.",
    ],
  ])("does not count abbreviations in a multiline %s", (_label, text) => {
    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test("preserves a true sentence boundary before a capitalized word", () => {
    const text = "One. Two. Three. Four. Five. The answer is no. Continue."

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test.each([
    ["listed abbreviation", "Include screws, etc. Continue with the procedure."],
    ["wrapped listed abbreviation", "Include screws, etc.\nContinue with the procedure."],
    ["capital initial", "Select option J. Continue with the procedure."],
    ["wrapped capital initial", "Select option J.\nContinue with the procedure."],
  ])("preserves a true boundary after a %s", (_label, text) => {
    expect(idsFor(`One. Two. Three. Four. Five. ${text}`)).toContain("paragraph-length")
  })

  test("does not restore a capital initial from a masked dotted identifier", () => {
    const text = "One. Two. Three. Four. Five. Use x.Y. Continue."

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test("flags a paragraph of quoted sentences", () => {
    const text = '"One." "Two." “Three.” ‘Four.’ "Five?" “Six!” "Seven."'

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test("flags sentences before closing Markdown delimiters", () => {
    const text = "*One.* **Two.** _Three._ ~~Four.~~ **Five.** _Six!_ *Seven?*"

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test("ignores punctuation inside inline code spans", () => {
    const text = "One. Two. Three. Four. Five. Six. `Seven. Eight.`"

    expect(idsFor(text)).not.toContain("paragraph-length")
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

  test("blockquoted list items are separate paragraphs", () => {
    const text = "> - One. Two.\n> - Three. Four.\n> - Five. Six.\n> - Seven. Eight."

    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test("flags a long blockquoted list item across continuation lines", () => {
    const text = "> - One. Two. Three.\n> Four. Five. Six. Seven."

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test("does not count an ordered-list marker as a sentence", () => {
    expect(idsFor("1. One. Two. Three. Four. Five. Six.")).not.toContain("paragraph-length")
  })

  test.each([
    "- One. Two. Three.\n Four. Five. Six. Seven.",
    "- One. Two. Three.\nFour. Five. Six. Seven.",
    "- One. Two. Three.\n#hashtag Four. Five. Six. Seven.",
  ])("flags a long list item across continuation lines", (text) => {
    expect(idsFor(text)).toContain("paragraph-length")
  })

  test("flags a long blockquote paragraph", () => {
    const text = "> One. Two. Three. Four. Five. Six. Seven."

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test("a blockquote starts a paragraph after preceding content", () => {
    const text = "One. Two. Three.\n> Four. Five. Six. Seven."

    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test("a blockquote ends a list item paragraph", () => {
    const text = "- One. Two. Three.\n> Four. Five. Six. Seven."

    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test.each([
    'One. Two. Three. Four. Five. Read [the docs](url "Version 1.") before setup.',
    'One. Two. Three. Four. Five. Read [docs](url "Version (beta.") before setup.',
    'One. Two. Three. Four. Five. Read [docs](<url(with-parenthesis> "Version 1.") before setup.',
  ])("ignores punctuation in Markdown link destinations and titles", (text) => {
    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test.each([".[", "](<"])(
    "scans large malformed Markdown suffixes without stalling",
    (part) => {
      const text = part.repeat(30_000)
      const start = performance.now()

      lint("prose-file", text)

      expect(performance.now() - start).toBeLessThan(5_000)
    },
    10_000,
  )

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
