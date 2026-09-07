import { Schema } from "effect"
import { NonEmptyTrimmedString } from "../schema/primitives.ts"
import { DICTIONARY_FORM_PATTERN, DICTIONARY_WORD_PATTERN } from "./form.ts"

const DictionarySourceSchema = Schema.Struct({
  name: NonEmptyTrimmedString,
  repository: NonEmptyTrimmedString,
  commit: NonEmptyTrimmedString,
  path: NonEmptyTrimmedString,
})

const DictionaryFormSchema = NonEmptyTrimmedString.pipe(Schema.pattern(DICTIONARY_FORM_PATTERN))

const DictionaryWordSchema = NonEmptyTrimmedString.pipe(Schema.pattern(DICTIONARY_WORD_PATTERN))

const DictionaryEntrySchema = Schema.Struct({
  unapproved: Schema.NonEmptyArray(DictionaryFormSchema),
  suggestions: Schema.NonEmptyArray(NonEmptyTrimmedString),
  partsOfSpeech: Schema.optional(Schema.NonEmptyArray(NonEmptyTrimmedString)),
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
