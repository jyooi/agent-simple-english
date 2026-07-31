// A token is exempt as an identifier when it has an interior signal prose
// words lack: a camelCase hump, an underscore, a dotted or :: path, or a
// call suffix. Mixed-case prose words (brand names) are an accepted loss.
const IDENTIFIER =
  /(?:[A-Za-z_$][\w$]*\(\)|(?:[A-Za-z$][\w$]*|_[\w$]+)(?:(?:\.|::)(?:[A-Za-z$][\w$]*|_[\w$]+))+(?:\(\))?|[A-Za-z_$][\w$]*(?:[a-z][A-Z]|[A-Za-z0-9$]_[A-Za-z0-9_$])[\w$]*(?:\(\))?)/g

export function blankIdentifiers(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(IDENTIFIER, (match) => " ".repeat(match.length)))
}
