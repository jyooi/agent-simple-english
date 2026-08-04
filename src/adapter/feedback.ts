import type { RuleId } from "../engine/rules/registry.ts"
import type { Violation } from "../engine/types.ts"

function suggestedFix(violation: Violation): string {
  if (violation.suggestion !== undefined) return `Use "${violation.suggestion}".`
  if (violation.suggestions !== undefined && violation.suggestions.length > 0) {
    return `Use one of these approved alternatives: ${violation.suggestions.map((item) => `"${item}"`).join(", ")}.`
  }
  const fixes: Readonly<Record<RuleId, string>> = {
    contraction: "Write the contracted words in full.",
    "dictionary-not-approved-word": "Use a word from the approved-word list.",
    hedging: "Delete the hedging phrase.",
    "invalid-suppression": "Name one or more registered rule IDs.",
    marketing: "Replace the phrase with factual language.",
    "paragraph-length": "Split the paragraph into shorter paragraphs.",
    "phrasal-verb": "Replace the phrasal verb with one approved verb.",
    semicolon: "Replace the semicolon with a full stop and write two sentences.",
    "sentence-length": "Split the sentence into shorter sentences.",
    "verb-progressive": "Use a permitted simple verb form.",
    "verb-passive": "Name the actor and use active voice.",
    "verb-perfect": "Use a permitted simple verb form.",
  }
  return fixes[violation.ruleId]
}

export function violationDetails(violations: readonly Violation[]): string {
  return violations
    .map(
      (violation) =>
        `- line ${violation.line}, column ${violation.column} [${violation.ruleId}]: ${violation.message} Suggested fix: ${suggestedFix(violation)}`,
    )
    .join("\n")
}

export function formatViolations(
  path: string,
  heading: string,
  violations: readonly Violation[],
): string {
  return `${heading} ${path}:\n${violationDetails(violations)}`
}
