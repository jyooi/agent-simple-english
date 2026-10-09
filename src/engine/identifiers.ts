const IDENTIFIER_CANDIDATE =
  /[A-Za-z_$][\w$]*(?:(?:\.|::)(?:[A-Za-z$][\w$]*|_+[A-Za-z0-9$][\w$]*))*(?:\(\))?/g

const hasCallSuffix = (token: string): boolean => token.endsWith("()")
const hasDottedPath = (token: string): boolean => token.includes(".")
const hasScopePath = (token: string): boolean => token.includes("::")
const hasCamelCaseHump = (token: string): boolean => /[a-z][A-Z]/.test(token)
const hasInteriorUnderscore = (token: string): boolean => /[A-Za-z0-9$]_[A-Za-z0-9_$]/.test(token)

const hasSignalThatProseWordsLack = (token: string): boolean =>
  hasCallSuffix(token) ||
  hasDottedPath(token) ||
  hasScopePath(token) ||
  hasCamelCaseHump(token) ||
  hasInteriorUnderscore(token)

export function blankIdentifiers(lines: readonly string[]): string[] {
  return lines.map((line) =>
    line.replace(IDENTIFIER_CANDIDATE, (match) =>
      hasSignalThatProseWordsLack(match) ? " ".repeat(match.length) : match,
    ),
  )
}
