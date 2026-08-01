import { mock } from "bun:test"

mock.module("wink-nlp", () => ({
  default: () => {
    throw new Error("forced tagger setup failure")
  },
}))
