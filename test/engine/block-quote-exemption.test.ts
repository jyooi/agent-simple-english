import { describe, expect, test } from "vitest"
import type { ApprovedWordList, Dictionary } from "../../src/dictionary/schema.ts"
import { lint } from "../../src/engine/lint.ts"

const dictionary = {
  formatVersion: 1,
  source: {
    name: "block quote test fixture",
    repository: "https://example.test/dictionary",
    commit: "fixture",
    path: "dictionary.json",
  },
  entries: [{ unapproved: ["approximately"], suggestions: ["about"] }],
} as const satisfies Dictionary

const approvedWords = {
  formatVersion: 1,
  source: {
    name: "block quote approved-word fixture",
    repository: "https://example.test/approved-words",
    commit: "fixture",
    path: "approved-words.json",
  },
  approvedWords: ["allowed"],
} as const satisfies ApprovedWordList

const quotedWording =
  "> We're rolling out a seamless change. Please note that this is approximately correct."

describe("lint prose-file: block quote exemption", () => {
  test("exempts quoted content from all wording rules", () => {
    const report = lint("prose-file", quotedWording, {
      dictionary,
      exemptBlockQuotes: true,
    })

    expect(report.violations).toEqual([])
  })

  test("exempts quotes in approved-word mode", () => {
    expect(
      lint("prose-file", "> Upstream vocabulary.", {
        dictionary: approvedWords,
        exemptBlockQuotes: true,
      }).violations,
    ).toEqual([])
  })

  test("keeps structural rules active in quoted content", () => {
    const words = Array.from({ length: 26 }, (_, index) => `word${index + 1}`).join(" ")
    const text = [
      "> One; two.",
      "",
      `> ${words}.`,
      "",
      "> One. Two. Three. Four. Five. Six. Seven.",
    ].join("\n")

    const report = lint("prose-file", text, { exemptBlockQuotes: true })

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "semicolon", line: 1, column: 6 }),
      expect.objectContaining({ ruleId: "sentence-length", line: 3, column: 3 }),
      expect.objectContaining({ ruleId: "paragraph-length", line: 5, column: 1 }),
    ])
  })

  test.each([
    ["> We're rolling out a seamless change."],
    ["> Start the quote\nWe're rolling out a seamless change."],
    ["> > We're rolling out a seamless change."],
    ["- > We're rolling out a seamless change."],
  ])("exempts CommonMark block quote form %#", (text) => {
    expect(lint("prose-file", text, { exemptBlockQuotes: true }).violations).toEqual([])
  })

  test("handles deeply nested block quotes", () => {
    const text = `${"> ".repeat(10_000)}We're rolling out a seamless change.`

    expect(lint("prose-file", text, { exemptBlockQuotes: true }).violations).toEqual([])
  })

  test("keeps default and disabled behavior unchanged", () => {
    expect(lint("prose-file", quotedWording, { dictionary })).toEqual(
      lint("prose-file", quotedWording, { dictionary, exemptBlockQuotes: false }),
    )
    expect(
      lint("prose-file", quotedWording, { dictionary }).violations.map(
        (violation) => violation.ruleId,
      ),
    ).toEqual([
      "contraction",
      "phrasal-verb",
      "marketing",
      "hedging",
      "dictionary-not-approved-word",
    ])
  })

  test("keeps structural findings in diff-only reports", () => {
    const words = Array.from({ length: 26 }, (_, index) => `word${index + 1}`).join(" ")

    const report = lint("prose-file", `> ${words}.`, {
      exemptBlockQuotes: true,
      previousText: "> Short quote.",
    })

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "sentence-length", line: 1, column: 3 }),
    ])
  })

  test("does not report retained outside wording after a quote-only edit", () => {
    const outside = "# Outside can't be approximately correct."

    const report = lint("prose-file", `> Revised quote\n${outside}`, {
      dictionary,
      exemptBlockQuotes: true,
      previousText: `> Old quote\n${outside}`,
    })

    expect(report.violations).toEqual([])
  })

  test("keeps an outside finding retained across a later edit separated by a quote", () => {
    const outside = "Outside can't proceed"
    const quote = "> # Quoted heading."

    const report = lint("prose-file", `${outside}\n${quote}\nRevised text.`, {
      exemptBlockQuotes: true,
      previousText: `${outside}\n${quote}\nFollowing text.`,
    })

    expect(report.violations).toEqual([])
  })

  test("keeps an outside approved-word finding retained across a separated edit", () => {
    const quote = "> Quoted heading."
    const approvedWordFixture = {
      ...approvedWords,
      approvedWords: ["following", "revised", "text"],
    } satisfies ApprovedWordList

    const report = lint("prose-file", `Unknown\n${quote}\nRevised text.`, {
      dictionary: approvedWordFixture,
      exemptBlockQuotes: true,
      previousText: `Unknown\n${quote}\nFollowing text.`,
    })

    expect(report.violations).toEqual([])
  })

  test("lints prose outside quotes at its original position", () => {
    const text = "> We're seamless.\n\nOutside prose can't be seamless."

    const report = lint("prose-file", text, { exemptBlockQuotes: true })

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "contraction", line: 3, column: 15 }),
      expect.objectContaining({ ruleId: "marketing", line: 3, column: 24 }),
    ])
  })
})
