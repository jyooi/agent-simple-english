import { Schema } from "effect"

// Effect v4 has no NonEmptyTrimmedString schema.
// Every call site imports this alias, so the definition stays in one file.
export const NonEmptyTrimmedString = Schema.Trimmed.check(Schema.isNonEmpty())
