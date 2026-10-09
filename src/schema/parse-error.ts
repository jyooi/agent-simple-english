import { type Schema, SchemaIssue } from "effect"

export type ParseError = Schema.SchemaError

export const DECODE_OPTIONS_THAT_REPORT_REJECTED_VALUE = {
  onExcessProperty: "error",
  errors: "all",
  reportInput: true,
} as const

export interface ParseErrorIssue {
  readonly path: ReadonlyArray<string | number>
  readonly message: string
}

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1()
const formatTree = SchemaIssue.makeFormatterDefault()

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
