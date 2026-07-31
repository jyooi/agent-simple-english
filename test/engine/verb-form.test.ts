import { describe, expect, test } from "vitest"
import { lint } from "../../src/engine/lint.ts"
import type { TaggedToken, Tagger } from "../../src/engine/tagger.ts"

// Stub tagger: each input line maps to a "word/POS/lemma ..." annotation,
// mirroring real wink-nlp output so the rule logic is tested without the model.
function stubTagger(annotations: Record<string, string>): Tagger {
  return (text) => {
    const annotation = annotations[text]
    if (annotation === undefined) {
      throw new Error(`stub tagger has no annotation for: "${text}"`)
    }
    const tokens: TaggedToken[] = []
    let cursor = 0
    for (const entry of annotation.split(" ")) {
      const [word, pos, lemma] = entry.split("/")
      if (word === undefined || pos === undefined || lemma === undefined) {
        throw new Error(`bad stub annotation entry: "${entry}"`)
      }
      const offset = text.indexOf(word, cursor)
      tokens.push({ text: word, pos, lemma, offset })
      cursor = offset + word.length
    }
    return tokens
  }
}

describe("lint prose-file: verb-form rules (stub tagger)", () => {
  test("flags passive voice as a soft violation with a rewrite hint", () => {
    const text = "The bolt was removed."
    const tagger = stubTagger({
      [text]: "The/DET/the bolt/NOUN/bolt was/AUX/be removed/VERB/remove ./PUNCT/.",
    })

    const report = lint("prose-file", text, { tagger })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({
      ruleId: "verb-passive",
      severity: "soft",
      line: 1,
      column: 10,
    })
    expect(report.violations[0]?.message).toContain("active voice")
    expect(report.violations[0]?.message).toContain('Found: "was removed"')
    expect(report.summary).toEqual({ total: 1, hard: 0 })
  })

  test("flags progressive tense as a hard violation", () => {
    const text = "The pump is running."
    const tagger = stubTagger({
      [text]: "The/DET/the pump/NOUN/pump is/AUX/be running/VERB/run ./PUNCT/.",
    })

    const report = lint("prose-file", text, { tagger })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({
      ruleId: "verb-progressive",
      severity: "hard",
      line: 1,
      column: 10,
    })
    expect(report.violations[0]?.message).toContain("simple tense")
    expect(report.violations[0]?.message).toContain('Found: "is running"')
  })

  test("flags perfect tense as a hard violation", () => {
    const text = "The technician has finished the task."
    const tagger = stubTagger({
      [text]:
        "The/DET/the technician/NOUN/technician has/AUX/have finished/VERB/finish the/DET/the task/NOUN/task ./PUNCT/.",
    })

    const report = lint("prose-file", text, { tagger })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({
      ruleId: "verb-perfect",
      severity: "hard",
      line: 1,
      column: 16,
    })
    expect(report.violations[0]?.message).toContain("simple past")
    expect(report.violations[0]?.message).toContain('Found: "has finished"')
  })

  test("does not flag active voice", () => {
    const text = "Remove the bolt."
    const tagger = stubTagger({
      [text]: "Remove/VERB/remove the/DET/the bolt/NOUN/bolt ./PUNCT/.",
    })

    expect(lint("prose-file", text, { tagger }).violations).toHaveLength(0)
  })

  test("detects passive across an intervening adverb", () => {
    const text = "The valve was quickly closed."
    const tagger = stubTagger({
      [text]:
        "The/DET/the valve/NOUN/valve was/AUX/be quickly/ADV/quickly closed/VERB/close ./PUNCT/.",
    })

    const report = lint("prose-file", text, { tagger })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]?.ruleId).toBe("verb-passive")
    expect(report.violations[0]?.message).toContain('Found: "was quickly closed"')
  })

  test("detects passive across a negation", () => {
    const text = "The results were not shown."
    const tagger = stubTagger({
      [text]: "The/DET/the results/NOUN/result were/AUX/be not/PART/not shown/VERB/show ./PUNCT/.",
    })

    const report = lint("prose-file", text, { tagger })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]?.ruleId).toBe("verb-passive")
  })

  test("does not flag an infinitive after a linking verb", () => {
    const text = "The goal is to win."
    const tagger = stubTagger({
      [text]: "The/DET/the goal/NOUN/goal is/AUX/be to/PART/to win/VERB/win ./PUNCT/.",
    })

    expect(lint("prose-file", text, { tagger }).violations).toHaveLength(0)
  })

  test("does not flag main-verb have", () => {
    const text = "The technicians have the tools."
    const tagger = stubTagger({
      [text]:
        "The/DET/the technicians/NOUN/technician have/VERB/have the/DET/the tools/NOUN/tool ./PUNCT/.",
    })

    expect(lint("prose-file", text, { tagger }).violations).toHaveLength(0)
  })

  test("flags 'has been sent' as passive only, mirroring the pi-ste reference", () => {
    const text = "The report has been sent."
    const tagger = stubTagger({
      [text]: "The/DET/the report/NOUN/report has/AUX/have been/AUX/be sent/VERB/send ./PUNCT/.",
    })

    const report = lint("prose-file", text, { tagger })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ ruleId: "verb-passive", severity: "soft" })
    expect(report.violations[0]?.message).toContain('Found: "been sent"')
  })

  test("skips verb-form rules when no tagger is provided", () => {
    expect(lint("prose-file", "The bolt was removed.").violations).toHaveLength(0)
  })

  test("reports the line of the violation and ignores fenced code blocks", () => {
    const passive = "The bolt was removed."
    const text = ["```", passive, "```", "", passive].join("\n")
    const tagger = stubTagger({
      [passive]: "The/DET/the bolt/NOUN/bolt was/AUX/be removed/VERB/remove ./PUNCT/.",
    })

    const report = lint("prose-file", text, { tagger })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ ruleId: "verb-passive", line: 5, column: 10 })
  })

  test("flags each occurrence on a line", () => {
    const text = "The bolt was removed. The panel was cleaned."
    const tagger = stubTagger({
      [text]:
        "The/DET/the bolt/NOUN/bolt was/AUX/be removed/VERB/remove ./PUNCT/. The/DET/the panel/NOUN/panel was/AUX/be cleaned/VERB/clean ./PUNCT/.",
    })

    const report = lint("prose-file", text, { tagger })

    expect(report.violations).toHaveLength(2)
    expect(report.violations[0]).toMatchObject({ ruleId: "verb-passive", column: 10 })
    expect(report.violations[1]).toMatchObject({ ruleId: "verb-passive", column: 33 })
  })
})
