import { Schema } from "effect"

// Effect v4 removes Schema.NonEmptyTrimmedString.
// Every call site imports this alias so the v4 migration changes one line.
export const NonEmptyTrimmedString = Schema.NonEmptyTrimmedString
