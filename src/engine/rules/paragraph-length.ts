import type { Paragraph } from "../paragraphs.ts"
import { segmentSentences } from "../sentences.ts"
import type { Tagger } from "../tagger.ts"
import type { Violation } from "../types.ts"

const MAX_SENTENCES = 6

export function paragraphLength(
  paragraphs: readonly Paragraph[],
  tagger?: Tagger,
): Violation[] {
  return paragraphs.flatMap((paragraph) => {
    const count = segmentSentences(
      paragraph.lines,
      paragraph.lines.join("\n"),
      undefined,
      paragraph.boundaryLines,
      tagger,
    ).length
    if (count <= MAX_SENTENCES) {
      return []
    }
    return [
      {
        ruleId: "paragraph-length",
        severity: "hard" as const,
        message: `Paragraph has ${count} sentences; the maximum is ${MAX_SENTENCES}.`,
        line: paragraph.line,
        column: paragraph.column,
      },
    ]
  })
}
