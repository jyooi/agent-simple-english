import type { Sentence } from "../sentences.ts"
import type { Violation } from "../types.ts"
import { DEFAULT_SEVERITIES } from "./registry.ts"

const countWords = (text: string): number => text.split(/\s+/).filter((word) => word !== "").length

export function sentenceLength(sentence: Sentence, maxWords: number): Violation | undefined {
  const count = countWords(sentence.text)
  if (count <= maxWords) return undefined
  return {
    ruleId: "sentence-length",
    severity: DEFAULT_SEVERITIES["sentence-length"],
    message: `Sentence has ${count} words; the maximum is ${maxWords}.`,
    line: sentence.line,
    column: sentence.column,
  }
}
