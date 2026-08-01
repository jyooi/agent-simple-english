// A token is exempt as an identifier when it has an interior signal prose
// words lack: a camelCase hump, an underscore, a dotted or :: path, or a
// call suffix. Mixed-case prose words (brand names) are an accepted loss.
const IDENTIFIER_CANDIDATE =
  /[A-Za-z_$][\w$]*(?:(?:\.|::)(?:[A-Za-z$][\w$]*|_+[A-Za-z0-9$][\w$]*))*(?:\(\))?/g

const isIdentifier = (token: string): boolean =>
  token.endsWith("()") ||
  token.includes(".") ||
  token.includes("::") ||
  /[a-z][A-Z]/.test(token) ||
  /[A-Za-z0-9$]_[A-Za-z0-9_$]/.test(token)

export function blankIdentifiers(lines: readonly string[]): string[] {
  return lines.map((line) =>
    line.replace(IDENTIFIER_CANDIDATE, (match) =>
      isIdentifier(match) ? " ".repeat(match.length) : match,
    ),
  )
}
