import { Effect } from "effect"
import { describe, expect, test } from "vitest"
import { decodeConfig } from "../../src/config/schema.ts"

const decode = (input: unknown) => Effect.runSync(Effect.either(decodeConfig(input, "test.json")))

const expectDecodeError = (input: unknown): string => {
  const result = decode(input)
  expect(result._tag).toBe("Left")
  return result._tag === "Left" ? result.left.message : ""
}

describe("config schema", () => {
  test("decodes a full valid config", () => {
    const result = decode({
      rules: { "sentence-length": "soft" },
      maxSentenceWords: 20,
      approvedWordsPath: "config/approved-words.json",
      ruleDataExtensions: {
        "adjectival-participle": ["config/adjectival-participles.json"],
      },
    })

    expect(result._tag).toBe("Right")
    if (result._tag === "Right") {
      expect(result.right).toEqual({
        rules: { "sentence-length": "soft" },
        maxSentenceWords: 20,
        approvedWordsPath: "config/approved-words.json",
        ruleDataExtensions: {
          "adjectival-participle": ["config/adjectival-participles.json"],
        },
      })
    }
  })

  test("decodes an empty config", () => {
    const result = decode({})

    expect(result._tag).toBe("Right")
  })

  test("accepts every severity setting for the dictionary rule", () => {
    for (const setting of ["hard", "soft", "off"]) {
      expect(decode({ rules: { "dictionary-not-approved-word": setting } })._tag).toBe("Right")
    }
  })

  test("a typo'd rule name produces a readable error naming the bad key", () => {
    const message = expectDecodeError({ rules: { "sentence-lenght": "hard" } })

    expect(message).toContain("sentence-lenght")
    expect(message).toContain("test.json")
  })

  test("an invalid severity value produces a readable error naming the value", () => {
    const message = expectDecodeError({ rules: { "sentence-length": "warn" } })

    expect(message).toContain("sentence-length")
    expect(message).toContain("warn")
    expect(message).toContain('"hard", "soft", or "off"')
  })

  test("an unknown top-level key produces a readable error naming the key", () => {
    const message = expectDecodeError({ maxSentenceWord: 10 })

    expect(message).toContain("maxSentenceWord")
  })

  test("maxSentenceWords must be a positive integer", () => {
    for (const bad of ["25", 0, 12.5]) {
      const message = expectDecodeError({ maxSentenceWords: bad })
      expect(message).toContain("maxSentenceWords")
      expect(message).toContain("positive integer")
    }
  })

  test("approvedWordsPath must be a non-empty string", () => {
    for (const bad of ["", "   ", 42]) {
      const message = expectDecodeError({ approvedWordsPath: bad })
      expect(message).toContain("approvedWordsPath")
    }
  })

  test("a non-object config is rejected", () => {
    expect(decode("hard")._tag).toBe("Left")
    expect(decode(null)._tag).toBe("Left")
  })
})
