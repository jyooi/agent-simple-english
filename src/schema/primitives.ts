import { Schema } from "effect"

export const NonEmptyTrimmedString = Schema.Trimmed.check(
  Schema.isNonEmpty({ expected: "a non-empty string" }),
)
