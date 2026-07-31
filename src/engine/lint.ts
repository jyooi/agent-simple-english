import { blankCodeFences } from "./markdown.ts"
import { sentenceLength } from "./rules/sentence-length.ts"
import { segmentSentences } from "./sentences.ts"
import type { LintKind, LintOptions, LintReport, Violation } from "./types.ts"

export const DEFAULT_MAX_SENTENCE_WORDS = 25

const linters: Record<LintKind, (text: string, maxSentenceWords: number) => Violation[]> = {
  "prose-file": (text, maxSentenceWords) =>
    sentenceLength(segmentSentences(blankCodeFences(text)), maxSentenceWords),
}

export function lint(kind: LintKind, text: string, options: LintOptions = {}): LintReport {
  const violations = linters[kind](text, options.maxSentenceWords ?? DEFAULT_MAX_SENTENCE_WORDS)
  return {
    violations,
    summary: {
      total: violations.length,
      hard: violations.filter((violation) => violation.severity === "hard").length,
    },
  }
}
