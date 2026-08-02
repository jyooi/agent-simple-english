import { Schema } from "effect"
import { DICTIONARY_FORM_PATTERN } from "./form.ts"

const DictionarySourceSchema = Schema.Struct({
  name: Schema.NonEmptyTrimmedString,
  repository: Schema.NonEmptyTrimmedString,
  commit: Schema.NonEmptyTrimmedString,
  path: Schema.NonEmptyTrimmedString,
})

const DictionaryFormSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(DICTIONARY_FORM_PATTERN),
)

const DictionaryEntrySchema = Schema.Struct({
  unapproved: Schema.NonEmptyArray(DictionaryFormSchema),
  suggestions: Schema.NonEmptyArray(Schema.NonEmptyTrimmedString),
  partsOfSpeech: Schema.optional(Schema.NonEmptyArray(Schema.NonEmptyTrimmedString)),
})

export const DictionarySchema = Schema.Struct({
  formatVersion: Schema.Literal(1),
  source: DictionarySourceSchema,
  entries: Schema.Array(DictionaryEntrySchema),
})

export const decodeDictionaryData = Schema.decodeUnknownSync(DictionarySchema, {
  onExcessProperty: "error",
  errors: "all",
})

export type Dictionary = typeof DictionarySchema.Type
export type DictionaryEntry = typeof DictionaryEntrySchema.Type
