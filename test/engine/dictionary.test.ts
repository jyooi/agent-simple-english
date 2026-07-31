import { describe, expect, test } from "vitest"
import type { Dictionary } from "../../src/dictionary/schema.ts"
import { lint } from "../../src/engine/lint.ts"
import type { Tagger } from "../../src/engine/tagger.ts"

const dictionary = {
  formatVersion: 1,
  source: {
    name: "test fixture",
    repository: "https://example.test/dictionary",
    commit: "fixture",
    path: "dictionary.json",
  },
  entries: [
    { unapproved: ["attempt", "attempts"], suggestions: ["try"], partsOfSpeech: ["VERB"] },
    { unapproved: ["approximately"], suggestions: ["about"] },
  ],
} as const satisfies Dictionary

const tagger: Tagger = (text) => {
  if (text === "Attempt the repair.") {
    return [
      { text: "Attempt", pos: "VERB", lemma: "attempt", offset: 0 },
      { text: "the", pos: "DET", lemma: "the", offset: 8 },
      { text: "repair", pos: "NOUN", lemma: "repair", offset: 12 },
      { text: ".", pos: "PUNCT", lemma: ".", offset: 18 },
    ]
  }
  if (text === "The attempt failed.") {
    return [
      { text: "The", pos: "DET", lemma: "the", offset: 0 },
      { text: "attempt", pos: "NOUN", lemma: "attempt", offset: 4 },
      { text: "failed", pos: "VERB", lemma: "fail", offset: 12 },
      { text: ".", pos: "PUNCT", lemma: ".", offset: 18 },
    ]
  }
  throw new Error(`missing tagger fixture for: ${text}`)
}

describe("lint prose-file: dictionary rule", () => {
  test("flags an unapproved word as hard and suggests its approved alternative", () => {
    const report = lint("prose-file", "Attempt the repair.", { dictionary, tagger })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: 'Use "try", not "Attempt".',
        suggestions: ["try"],
        line: 1,
        column: 1,
      },
    ])
  })

  test("does not flag approved alternatives", () => {
    expect(lint("prose-file", "Try the repair.", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", "It is about five millimeters.", { dictionary }).violations).toEqual(
      [],
    )
  })

  test("uses POS metadata to allow a noun and reject the same word as a verb", () => {
    expect(lint("prose-file", "The attempt failed.", { dictionary, tagger }).violations).toEqual([])
    expect(
      lint("prose-file", "Attempt the repair.", { dictionary, tagger }).violations.map(
        (violation) => violation.ruleId,
      ),
    ).toEqual(["dictionary-not-approved-word"])
  })

  test("falls back to word-level matching when POS metadata is absent", () => {
    const report = lint("prose-file", "It is approximately five millimeters.", { dictionary })

    expect(report.violations[0]).toMatchObject({
      ruleId: "dictionary-not-approved-word",
      message: 'Use "about", not "approximately".',
      suggestions: ["about"],
      column: 7,
    })
  })

  test("skips POS-aware entries when no tagger is available", () => {
    expect(lint("prose-file", "Attempt the repair.", { dictionary }).violations).toEqual([])
  })
})
