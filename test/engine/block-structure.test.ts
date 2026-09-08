import { describe, expect, test } from "vitest"
import type { Dictionary } from "../../src/dictionary/schema.ts"
import { lint } from "../../src/engine/lint.ts"

// Block structure decides where a sentence, a paragraph, and a dictionary phrase
// end. Each seam below pins that decision for one Markdown construct so a drift
// in the block parser fails here instead of in user output.

const dictionary = {
  formatVersion: 1,
  source: {
    name: "test fixture",
    repository: "https://example.test/dictionary",
    commit: "fixture",
    path: "dictionary.json",
  },
  entries: [{ unapproved: ["in order to"], suggestions: ["to"] }],
} as const satisfies Dictionary

const words = (count: number): string =>
  Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ")

const positions = (text: string): Array<[string, number, number]> =>
  lint("prose-file", text, { dictionary }).violations.map((violation) => [
    violation.ruleId,
    violation.line,
    violation.column,
  ])

const messages = (text: string): string[] =>
  lint("prose-file", text, { dictionary }).violations.map((violation) => violation.message)

describe("block structure: sentence segmentation", () => {
  // The abbreviation lookahead reads past the end of a line. A block start must
  // stop it, or the sentence absorbs the next block and reports a false length.
  const opener = `${words(24)}, etc.`

  test("a list item ends the sentence before it", () => {
    expect(positions(`${opener}\n- Continue.`)).toEqual([])
  })

  test("a block quote ends the sentence before it", () => {
    expect(positions(`${opener}\n> Continue.`)).toEqual([])
  })

  test("a list item inside a block quote ends the sentence before it", () => {
    expect(positions(`${opener}\n> - Continue.`)).toEqual([])
  })

  test("an ATX heading ends the sentence before it", () => {
    expect(positions(`${opener}\n# Continue.`)).toEqual([])
    expect(positions(`${opener}\n> - # Continue.`)).toEqual([])
  })

  // An HTML block hides its inner lines from the block parser. The ATX marker on
  // such a line still ends the sentence, while a marker with no space does not.
  test("an ATX marker inside an HTML block ends the sentence before it", () => {
    expect(messages(`<div>\n${opener}\n# Continue here.\n</div>`)).toEqual([
      "Sentence has 26 words; the maximum is 25.",
    ])
    expect(messages(`<div>\n${opener}\n#Continue here.\n</div>`)).toEqual([
      "Sentence has 28 words; the maximum is 25.",
    ])
  })

  test("a thematic break ends the sentence before it", () => {
    expect(positions(`${opener}\n***\nContinue.`)).toEqual([])
    expect(positions(`${opener}\n- - -\nContinue.`)).toEqual([])
  })

  // A setext underline binds to the line above it, so the heading text and the
  // underline stay one block and the sentence runs on. This pins that loss.
  test("a setext underline keeps the sentence open across the heading", () => {
    expect(positions(`${opener}\n===\nContinue.`)).toEqual([["sentence-length", 1, 1]])
  })

  test("a setext heading joins the paragraph that follows it", () => {
    expect(positions(`Head\n===\n${words(26)}.`)).toEqual([["sentence-length", 1, 1]])
  })
})

describe("block structure: paragraph segmentation", () => {
  // Seven sentences exceed the cap. A paragraph boundary splits them into three
  // plus four and reports nothing, so a missed boundary shows up as a violation.
  const head = "One. Two. Three."
  const tail = "Four. Five. Six. Seven."

  test("a list item starts its own paragraph", () => {
    expect(positions(`${head}\n- ${tail}`)).toEqual([])
    expect(positions(`${head}\n1. ${tail}`)).toEqual([])
    expect(positions(`- ${head}\n- ${tail}`)).toEqual([])
  })

  test("a block quote starts its own paragraph", () => {
    expect(positions(`${head}\n> ${tail}`)).toEqual([])
  })

  test("a list item inside a block quote starts its own paragraph", () => {
    expect(positions(`${head}\n> - ${tail}`)).toEqual([])
    expect(positions(`> - ${head}\n> - ${tail}`)).toEqual([])
    expect(positions(`> - ${head}\n>   ${tail}`)).toEqual([["paragraph-length", 1, 1]])
  })

  test("an ATX heading ends the paragraph", () => {
    expect(positions(`${head}\n## A heading\n${tail}`)).toEqual([])
    expect(positions(`${head}\n> - # Head\n${tail}`)).toEqual([])
  })

  test("a bullet thematic break ends the paragraph", () => {
    expect(positions(`${head}\n- - -\n${tail}`)).toEqual([])
  })

  // A star thematic break and a setext underline both read as prose today, so
  // the paragraph runs through them. These two cases pin that loss.
  test("a star thematic break keeps the paragraph open", () => {
    expect(positions(`${head}\n***\n${tail}`)).toEqual([["paragraph-length", 1, 1]])
  })

  test("a setext underline keeps the paragraph open", () => {
    expect(positions(`${head}\n===\n${tail}`)).toEqual([["paragraph-length", 1, 1]])
  })

  test("a deeper block quote keeps the paragraph open", () => {
    expect(positions(`> ${head}\n> > ${tail}`)).toEqual([["paragraph-length", 1, 1]])
  })
})

describe("block structure: dictionary soft line breaks", () => {
  // A two-word form matches across a line break only inside one block. Each seam
  // pins one joined case and one separated case.
  const joined: [string, number, number][] = [["dictionary-not-approved-word", 1, 3]]

  test("a list item joins its own continuation line and no other item", () => {
    expect(positions("- in order\n  to continue")).toEqual(joined)
    expect(positions("- in order\n- to continue")).toEqual([])
  })

  test("a block quote joins its own continuation line and no deeper quote", () => {
    expect(positions("> in order\n> to continue")).toEqual(joined)
    expect(positions("> in order\n> > to continue")).toEqual([])
  })

  test("a quoted list item joins its own continuation line only", () => {
    expect(positions("> - in order\n>   to continue")).toEqual([
      ["dictionary-not-approved-word", 1, 5],
    ])
    expect(positions("> - # in order\nto continue")).toEqual([])
  })

  test("an ATX heading never joins the line beside it", () => {
    expect(positions("# In order\nto continue")).toEqual([])
    expect(positions("in order\n# to continue")).toEqual([])
    expect(positions("- # in order\nto continue")).toEqual([])
  })

  test("a setext heading joins its own text lines and stops at the underline", () => {
    expect(positions("Use in order\nto continue\n===")).toEqual([
      ["dictionary-not-approved-word", 1, 5],
    ])
    expect(positions("in order\n===\nto continue")).toEqual([])
  })

  test("a thematic break never joins the lines around it", () => {
    expect(positions("in order\n***\nto continue")).toEqual([])
    expect(positions("Use in order\nto continue\n***")).toEqual([
      ["dictionary-not-approved-word", 1, 5],
    ])
  })
})
