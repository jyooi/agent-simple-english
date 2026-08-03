import { bench, describe } from "vitest"
import { blankMarkdownDestinations } from "../../src/engine/markdown.ts"

const sizes = [4_000, 8_000, 16_000] as const
const benchmarkOptions = {
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
    bench(
      `deep image nesting at ${size} levels`,
      () => {
        blankMarkdownDestinations([nestedImages.get(size) ?? ""])
      },
      benchmarkOptions,
    )
  }

  for (const size of sizes) {
    bench(
      `long unbalanced resource sequence at ${size} units`,
      () => {
        blankMarkdownDestinations([unbalancedResources.get(size) ?? ""])
      },
      benchmarkOptions,
    )
  }
})
