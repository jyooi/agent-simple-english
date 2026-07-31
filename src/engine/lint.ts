import type { Dictionary } from "../dictionary/schema.ts"
import { extractHashComments, extractSlashComments } from "./comments.ts"
import { blankIdentifiers } from "./identifiers.ts"
import { blankInlineCode, blankMarkdownCode } from "./markdown.ts"
import { segmentParagraphs } from "./paragraphs.ts"
import { contraction } from "./rules/contraction.ts"
import { dictionaryRule } from "./rules/dictionary.ts"
import { hedging } from "./rules/hedging.ts"
import { marketing } from "./rules/marketing.ts"
import { paragraphLength } from "./rules/paragraph-length.ts"
import { phrasalVerb } from "./rules/phrasal-verb.ts"
import { semicolon } from "./rules/semicolon.ts"
import { sentenceLength } from "./rules/sentence-length.ts"
import { verbForm } from "./rules/verb-form.ts"
import { segmentSentences } from "./sentences.ts"
import type { Tagger } from "./tagger.ts"
import type { LintKind, LintOptions, LintReport, Violation } from "./types.ts"

export const DEFAULT_MAX_SENTENCE_WORDS = 25

interface ResolvedOptions {
  readonly maxSentenceWords: number
  readonly dictionary?: Dictionary
  readonly tagger?: Tagger
}

const extractors: Record<LintKind, (text: string) => string[]> = {
  "prose-file": blankMarkdownCode,
  "slash-source": extractSlashComments,
  "hash-source": extractHashComments,
  "commit-message": (text) => text.split("\n"),
}

const lintProse = (
  lines: string[],
  { maxSentenceWords, dictionary, tagger }: ResolvedOptions,
) => {
  const proseLines = blankInlineCode(lines)
  return [
    ...sentenceLength(segmentSentences(proseLines), maxSentenceWords),
    ...paragraphLength(segmentParagraphs(proseLines)),
    ...contraction(proseLines),
    ...semicolon(lines),
    ...phrasalVerb(proseLines),
    ...hedging(proseLines),
    ...marketing(proseLines),
    ...(dictionary === undefined ? [] : dictionaryRule(lines, dictionary, tagger)),
    ...(tagger === undefined ? [] : verbForm(lines, tagger)),
  ]
}

export function lint(kind: LintKind, text: string, options: LintOptions = {}): LintReport {
  const prose = blankIdentifiers(extractors[kind](text))
  const raw = lintProse(prose, {
    maxSentenceWords: options.maxSentenceWords ?? DEFAULT_MAX_SENTENCE_WORDS,
    dictionary: options.dictionary,
    tagger: options.tagger,
  })
  const violations: Violation[] = raw
    .flatMap((violation) => {
      const setting = options.rules?.[violation.ruleId]
      if (setting === undefined) {
        return [violation]
      }
      return setting === "off" ? [] : [{ ...violation, severity: setting }]
    })
    .sort((a, b) => a.line - b.line || a.column - b.column)
  return {
    violations,
    summary: {
      total: violations.length,
      hard: violations.filter((violation) => violation.severity === "hard").length,
    },
  }
}
