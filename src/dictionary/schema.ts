import { Schema } from "effect"

const DictionarySourceSchema = Schema.Struct({
  name: Schema.NonEmptyTrimmedString,
  repository: Schema.NonEmptyTrimmedString,
  commit: Schema.NonEmptyTrimmedString,
  path: Schema.NonEmptyTrimmedString,
})

const DictionaryEntrySchema = Schema.Struct({
  unapproved: Schema.NonEmptyArray(Schema.NonEmptyTrimmedString),
  suggestions: Schema.NonEmptyArray(Schema.NonEmptyTrimmedString),
  partsOfSpeech: Schema.optional(Schema.NonEmptyArray(Schema.NonEmptyTrimmedString)),
})

export const DictionarySchema = Schema.Struct({
  formatVersion: Schema.Literal(1),
  source: DictionarySourceSchema,
  entries: Schema.Array(DictionaryEntrySchema),
})

export type Dictionary = typeof DictionarySchema.Type
export type DictionaryEntry = typeof DictionaryEntrySchema.Type
