import type { Sentence } from "../sentences.ts"
import type { Violation } from "../types.ts"

export function sentenceLength(sentences: readonly Sentence[], maxWords: number): Violation[] {
  return sentences.flatMap((sentence) => {
    const count = countWords(sentence.text)
    if (count <= maxWords) {
      return []
    }
    return [
      {
        ruleId: "sentence-length",
        severity: "hard" as const,
        message: `Sentence has ${count} words; the maximum is ${maxWords}.`,
        line: sentence.line,
        column: sentence.column,
      },
    ]
  })
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length
}
