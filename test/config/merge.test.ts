import { describe, expect, test } from "vitest"
import { mergeConfigs } from "../../src/config/merge.ts"

describe("config merge", () => {
  test("project scalar wins over global", () => {
    const merged = mergeConfigs({ maxSentenceWords: 20 }, { maxSentenceWords: 15 })

    expect(merged).toEqual({ maxSentenceWords: 15 })
  })

  test("rules deep-merge per key with project winning", () => {
    const merged = mergeConfigs(
      { rules: { "sentence-length": "soft" }, maxSentenceWords: 20 },
      { rules: { "sentence-length": "off" } },
    )

    expect(merged).toEqual({ rules: { "sentence-length": "off" }, maxSentenceWords: 20 })
  })

  test("keys set only on one side survive the merge", () => {
    const merged = mergeConfigs({ rules: { "sentence-length": "soft" } }, { maxSentenceWords: 15 })

    expect(merged).toEqual({ rules: { "sentence-length": "soft" }, maxSentenceWords: 15 })
  })

  test("empty configs merge to empty", () => {
    expect(mergeConfigs({}, {})).toEqual({})
  })
})
