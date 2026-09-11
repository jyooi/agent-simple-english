import type { Paragraph } from "../paragraphs.ts"
import { segmentSentences } from "../sentences.ts"
import type { Violation } from "../types.ts"

const MAX_SENTENCES = 6

export function paragraphLength(paragraph: Paragraph): Violation | undefined {
  const count = segmentSentences(
    paragraph.lines,
    paragraph.lines.join("\n"),
    undefined,
    paragraph.boundaryLines,
  ).length
  if (count <= MAX_SENTENCES) return undefined
  return {
    ruleId: "paragraph-length",
    severity: "hard",
    message: `Paragraph has ${count} sentences; the maximum is ${MAX_SENTENCES}.`,
    line: paragraph.line,
    column: paragraph.column,
  }
}
