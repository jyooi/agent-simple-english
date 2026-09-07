import { ParseResult } from "effect"

// This isolates the Effect v3 `ParseResult` module calls, which Effect v4
// removes, so the later migration changes only this file.

export type ParseError = ParseResult.ParseError

export interface ParseErrorIssue {
  readonly path: ReadonlyArray<string | number>
  readonly message: string
}

export const formatParseErrorIssues = (error: ParseError): ParseErrorIssue[] =>
  ParseResult.ArrayFormatter.formatErrorSync(error).map((issue) => ({
    path: issue.path as ReadonlyArray<string | number>,
    message: issue.message,
  }))

export const formatParseErrorTree = (error: ParseError): string =>
  ParseResult.TreeFormatter.formatErrorSync(error)
