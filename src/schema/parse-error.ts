import { type Schema, SchemaIssue } from "effect"

// This isolates the Effect v4 `SchemaIssue` formatter calls, so a later
// Schema change touches only this file.

export type ParseError = Schema.SchemaError

export interface ParseErrorIssue {
  readonly path: ReadonlyArray<string | number>
  readonly message: string
}

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1()
const formatTree = SchemaIssue.makeFormatterDefault()

// A Standard Schema path segment is either a raw key or a `{ key }` wrapper,
// and symbol keys never appear in this package's schemas.
const pathSegments = (
  path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined,
): ReadonlyArray<string | number> =>
  (path ?? []).map((segment) => {
    const key = typeof segment === "object" ? segment.key : segment
    return typeof key === "number" ? key : String(key)
  })

export const formatParseErrorIssues = (error: ParseError): ParseErrorIssue[] =>
  formatIssues(error.issue).issues.map((issue) => ({
    path: pathSegments(issue.path),
    message: issue.message,
  }))

export const formatParseErrorTree = (error: ParseError): string => formatTree(error.issue)
