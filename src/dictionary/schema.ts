import { Schema } from "effect"
import { DICTIONARY_FORM_PATTERN, DICTIONARY_WORD_PATTERN } from "./form.ts"

const DictionarySourceSchema = Schema.Struct({
  name: Schema.NonEmptyTrimmedString,
  repository: Schema.NonEmptyTrimmedString,
  commit: Schema.NonEmptyTrimmedString,
  path: Schema.NonEmptyTrimmedString,
})

const DictionaryFormSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(DICTIONARY_FORM_PATTERN),
)

const DictionaryWordSchema = Schema.NonEmptyTrimmedString.pipe(
  Schema.pattern(DICTIONARY_WORD_PATTERN),
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

export const ApprovedWordListSchema = Schema.Struct({
  formatVersion: Schema.Literal(1),
  source: DictionarySourceSchema,
  approvedWords: Schema.NonEmptyArray(DictionaryWordSchema),
})

export type Dictionary = typeof DictionarySchema.Type
export type DictionaryEntry = typeof DictionaryEntrySchema.Type
export type ApprovedWordList = typeof ApprovedWordListSchema.Type
export type DictionaryData = Dictionary | ApprovedWordList
