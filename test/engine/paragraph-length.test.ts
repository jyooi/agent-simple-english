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
    ["Fig.", "See Fig. A for details."],
    ["No.", "Use part No. A for assembly."],
  ])("keeps a single-capital designator after %s", (_label, sentence) => {
    expect(idsFor(`One. Two. Three. Four. Five. ${sentence}`)).not.toContain("paragraph-length")
  })

  test.each([
    ["a lowercase title", "Ask technician J. Smith for details."],
    ["a recipient name", "Send the report to J. Smith for approval."],
    ["a wrapped name", "Ask technician J.\nSmith for details."],
    ["an ambiguous boundary", "Select option J. Continue with the procedure."],
  ])("keeps a capital initial inside %s", (_label, sentence) => {
    expect(idsFor(`One. Two. Three. Four. Five. ${sentence}`)).not.toContain("paragraph-length")
  })

  test.each([
    ["an abbreviation", "Use _e.g._ model two."],
    ["an abbreviation in a larger span", "Use _e.g. model two_ today."],
    ["a capital initial", "Ask _J._ Smith for details."],
    ["a capital initial in a larger span", "Ask _J. Smith_ for details."],
    ["an abbreviation spanning lines", "Use _e.g. model\n two_ today."],
  ])("keeps underscore-emphasized %s inside a sentence", (_label, sentence) => {
    expect(idsFor(`One. Two. Three. Four. Five. ${sentence}`)).not.toContain("paragraph-length")
  })

  test("does not treat an identifier underscore as Markdown emphasis", () => {
    const text = "One. Two. Three. Four. Five. Use prefix_e.g. Continue."

    expect(idsFor(text)).toContain("paragraph-length")
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
    ["quoted list item", "> - One. Two. Three. Use a model,\n>   e.g. model two. Four. Five."],
  ])("does not count abbreviations in a multiline %s", (_label, text) => {
    expect(idsFor(text)).not.toContain("paragraph-length")
  })

  test("preserves a true sentence boundary before a capitalized word", () => {
    const text = "One. Two. Three. Four. Five. The answer is no. Continue."

    expect(idsFor(text)).toContain("paragraph-length")
  })

  test.each([
    ["example abbreviation", "Use e.g. Continue with the procedure."],
    ["explanation abbreviation", "Use i.e. Continue with the procedure."],
    ["listed abbreviation", "Include screws, etc. Continue with the procedure."],
    ["comparison abbreviation", "Use vs. Continue with the procedure."],
    ["mentioned abbreviation", "The abbreviation is _e.g._ Continue."],
    ["emphasized abbreviation after a verb", "Write _e.g._ Continue."],
    ["wrapped listed abbreviation", "Include screws, etc.\nContinue with the procedure."],
    ["number abbreviation", "The answer is No. Continue with the procedure."],
    ["multi-capital number suffix", "Use part No. AX for assembly."],
    ["number abbreviation before capitals", "The answer is No. STOP the machine."],
    ["number abbreviation before a short command", "The answer is No. DO NOT continue."],
    ["figure abbreviation before capitals", "The result is Fig. STOP the machine."],
    ["number abbreviation before a command", "The answer is No. Use the other part."],
    ["linked abbreviation", "[Include screws, etc.](url) Continue with the procedure."],
    ["referenced abbreviation", "Include screws, etc.[^1] Continue with the procedure."],
    ["bracketed sentence", "Include screws, etc. [Continue with the procedure.]"],
    ["parenthetical sentence", "Include screws, etc. (Continue with the procedure.)"],
    ["wrapped parenthetical sentence", "Include screws, etc.\n(Continue with the procedure.)"],
  ])("preserves a true boundary after a %s", (_label, text) => {
    expect(idsFor(`One. Two. Three. Four. Five. ${text}`)).toContain("paragraph-length")
  })

  test.each([
    ["a figure reference", "Review Fig. A for details."],
    ["a copular figure reference", "The reference is Fig. A for details."],
    ["a part number", "Install No. 7 in the assembly."],
  ])("keeps %s after an unlisted preceding word", (_label, sentence) => {
    expect(idsFor(`One. Two. Three. Four. Five. ${sentence}`)).not.toContain("paragraph-length")
  })

  test.each(["e.g.", "i.e.", "etc.", "vs.", "Fig.", "No."])(
    "preserves a true boundary after quoted %s",
    (abbreviation) => {
      const text = `One. Two. Three. Four. Five. The abbreviation is "${abbreviation}" Continue.`

      expect(idsFor(text)).toContain("paragraph-length")
    },
  )

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

  test.each([
    ["without abbreviations", "wrapped prose without punctuation"],
    ["with abbreviations", "use e.g. wrapped prose"],
    ["with unclosed emphasis", "use _e.g. wrapped prose"],
  ])(
    "scans hard-wrapped prose %s in linear time",
    (_label, line) => {
      const text = Array.from({ length: 10_000 }, () => line).join("\n")
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
