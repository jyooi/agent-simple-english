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

describe("block structure: a block start stops the abbreviation lookahead of a sentence", () => {
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

  test("an ATX marker inside an HTML block is HTML data and does not end the sentence", () => {
    expect(messages(`<div>\n${opener}\n# Continue here.\n</div>`)).toEqual([
      "Sentence has 29 words; the maximum is 25.",
    ])
    expect(messages(`<div>\n${opener}\n#Continue here.\n</div>`)).toEqual([
      "Sentence has 28 words; the maximum is 25.",
    ])
  })

  test("a thematic break ends the sentence before it", () => {
    expect(positions(`${opener}\n***\nContinue.`)).toEqual([])
    expect(positions(`${opener}\n- - -\nContinue.`)).toEqual([])
  })

  test("a setext underline binds to the line above it and keeps the sentence open, a pinned loss", () => {
    expect(positions(`${opener}\n===\nContinue.`)).toEqual([["sentence-length", 1, 1]])
  })

  test("a setext heading joins the paragraph that follows it", () => {
    expect(positions(`Head\n===\n${words(26)}.`)).toEqual([["sentence-length", 1, 1]])
  })
})

describe("block structure: a paragraph boundary splits seven sentences below the cap", () => {
  const threeSentences = "One. Two. Three."
  const fourSentences = "Four. Five. Six. Seven."

  test("a list item starts its own paragraph", () => {
    expect(positions(`${threeSentences}\n- ${fourSentences}`)).toEqual([])
    expect(positions(`${threeSentences}\n1. ${fourSentences}`)).toEqual([])
    expect(positions(`- ${threeSentences}\n- ${fourSentences}`)).toEqual([])
  })

  test("a block quote starts its own paragraph", () => {
    expect(positions(`${threeSentences}\n> ${fourSentences}`)).toEqual([])
  })

  test("a list item inside a block quote starts its own paragraph", () => {
    expect(positions(`${threeSentences}\n> - ${fourSentences}`)).toEqual([])
    expect(positions(`> - ${threeSentences}\n> - ${fourSentences}`)).toEqual([])
    expect(positions(`> - ${threeSentences}\n>   ${fourSentences}`)).toEqual([
      ["paragraph-length", 1, 1],
    ])
  })

  test("an ATX heading ends the paragraph", () => {
    expect(positions(`${threeSentences}\n## A heading\n${fourSentences}`)).toEqual([])
    expect(positions(`${threeSentences}\n> - # Head\n${fourSentences}`)).toEqual([])
  })

  test("a bullet thematic break ends the paragraph", () => {
    expect(positions(`${threeSentences}\n- - -\n${fourSentences}`)).toEqual([])
  })

  test("a star thematic break ends the paragraph", () => {
    expect(positions(`${threeSentences}\n***\n${fourSentences}`)).toEqual([])
  })

  test("a setext underline ends the paragraph", () => {
    expect(positions(`${threeSentences}\n===\n${fourSentences}`)).toEqual([])
  })

  test("a deeper block quote ends the paragraph", () => {
    expect(positions(`> ${threeSentences}\n> > ${fourSentences}`)).toEqual([])
  })
})

describe("block structure: a dictionary form joins across a line break only inside one block", () => {
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
