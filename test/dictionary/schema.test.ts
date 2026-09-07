import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { ApprovedWordListSchema, decodeDictionaryData } from "../../src/dictionary/schema.ts"

const source = {
  name: "ASD-STE100",
  repository: "https://example.com/ste",
  commit: "abc123",
  path: "dictionary.json",
}

const validDictionary = {
  formatVersion: 1,
  source,
  entries: [{ unapproved: ["utilize"], suggestions: ["use"], partsOfSpeech: ["verb"] }],
}

const decodeApprovedWords = Schema.decodeUnknownSync(ApprovedWordListSchema, { errors: "all" })

describe("dictionary schema", () => {
  test("decodes a valid dictionary", () => {
    expect(decodeDictionaryData(validDictionary)).toEqual(validDictionary)
  })

  test("decodes a valid approved-word list", () => {
    const list = { formatVersion: 1, source, approvedWords: ["use", "remove"] }
    expect(decodeApprovedWords(list)).toEqual(list)
  })

  test("rejects blank strings in every source field", () => {
    for (const field of ["name", "repository", "commit", "path"] as const) {
      for (const bad of ["", "   "]) {
        expect(() =>
          decodeDictionaryData({ ...validDictionary, source: { ...source, [field]: bad } }),
        ).toThrow(field)
      }
    }
  })

  test("rejects blank suggestions and parts of speech", () => {
    for (const bad of ["", "  "]) {
      expect(() =>
        decodeDictionaryData({
          ...validDictionary,
          entries: [{ unapproved: ["utilize"], suggestions: [bad] }],
        }),
      ).toThrow("suggestions")
      expect(() =>
        decodeDictionaryData({
          ...validDictionary,
          entries: [{ unapproved: ["utilize"], suggestions: ["use"], partsOfSpeech: [bad] }],
        }),
      ).toThrow("partsOfSpeech")
    }
  })

  test("rejects blank unapproved forms and approved words", () => {
    for (const bad of ["", "  "]) {
      expect(() =>
        decodeDictionaryData({
          ...validDictionary,
          entries: [{ unapproved: [bad], suggestions: ["use"] }],
        }),
      ).toThrow("unapproved")
      expect(() => decodeApprovedWords({ formatVersion: 1, source, approvedWords: [bad] })).toThrow(
        "approvedWords",
      )
    }
  })

  test("rejects strings with surrounding whitespace", () => {
    expect(() =>
      decodeDictionaryData({ ...validDictionary, source: { ...source, name: " ASD " } }),
    ).toThrow("name")
  })
})
