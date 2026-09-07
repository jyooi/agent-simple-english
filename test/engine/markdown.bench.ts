import { describe, test } from "vitest"
import { blankMarkdownDestinations } from "../../src/engine/markdown.ts"

const sizes = [4_000, 8_000, 16_000] as const
const runOptions = {
  iterations: 1,
  time: 0,
  warmupIterations: 1,
  warmupTime: 0,
}

const nestedImages = new Map(
  sizes.map((size) => [size, `${"![x ".repeat(size)}x${"](target)".repeat(size)}`]),
)
const unbalancedResources = new Map(sizes.map((size) => [size, "[a](".repeat(size)]))

describe("Markdown parser scaling", () => {
  for (const size of sizes) {
    const name = `deep image nesting at ${size} levels`

    test(name, async ({ bench }) => {
      await bench(name, () => {
        blankMarkdownDestinations([nestedImages.get(size) ?? ""])
      }).run(runOptions)
    })
  }

  for (const size of sizes) {
    const name = `long unbalanced resource sequence at ${size} units`

    test(name, async ({ bench }) => {
      await bench(name, () => {
        blankMarkdownDestinations([unbalancedResources.get(size) ?? ""])
      }).run(runOptions)
    })
  }
})
