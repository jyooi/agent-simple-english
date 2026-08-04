import { describe, expect, test } from "vitest"
import type { Dictionary } from "../../src/dictionary/schema.ts"
import { lint } from "../../src/engine/lint.ts"
import type { TaggedToken, Tagger } from "../../src/engine/tagger.ts"

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

const tagger: Tagger = (line) => {
  if (line !== "author: someone has trusted") return []

  return [
    { text: "has", pos: "AUX", lemma: "have", offset: 16 },
    { text: "trusted", pos: "VERB", lemma: "trust", offset: 20 },
  ] satisfies TaggedToken[]
}

const words = (count: number): string =>
  Array.from({ length: count }, (_, index) => `word${index + 1}`).join(" ")

describe("lint prose-file: YAML frontmatter masking", () => {
  test("masks YAML frontmatter from all prose rules", () => {
    const text = [
      "---",
      "title: A seamless attempt as mentioned.",
      "note: It isn't ready and must carry out this task; retry it.",
      `summary: ${words(26)}.`,
      "sentences: One. Two. Three. Four. Five. Six. Seven.",
      "author: someone has trusted",
      "---",
      "",
      "Body text here.",
    ].join("\n")

    expect(lint("prose-file", text, { dictionary, tagger }).violations).toEqual([])
  })

  test("lints prose after frontmatter at its original position", () => {
    const text = ["---", "title: Plain metadata", "---", "This isn't ready."].join("\n")

    expect(lint("prose-file", text).violations).toEqual([
      expect.objectContaining({ ruleId: "contraction", line: 4, column: 6 }),
    ])
  })

  test("does not mask a thematic break in the middle of a document", () => {
    const text = ["Intro text.", "", "---", "title: This isn't hidden.", "---"].join("\n")

    expect(lint("prose-file", text).violations).toEqual([
      expect.objectContaining({ ruleId: "contraction", line: 4, column: 13 }),
    ])
  })

  test("keeps changed frontmatter out of diff-only findings", () => {
    const previousText = ["---", "title: Plain metadata", "---", "Body text."].join("\n")
    const text = ["---", "title: It isn't visible", "---", "Body text."].join("\n")

    expect(lint("prose-file", text, { previousText }).violations).toEqual([])
  })
})
