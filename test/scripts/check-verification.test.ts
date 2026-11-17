import { describe, expect, test } from "vitest"
import { hasStateChartPart } from "../../scripts/check-verification.ts"

describe("State chart part of a PR", () => {
  test("accepts a State chart heading with a mermaid chart", () => {
    expect(
      hasStateChartPart(
        "## Summary\n\nText.\n\n## State chart\n\n```mermaid\nstateDiagram-v2\n```\n",
      ),
    ).toBe(true)
  })

  test("accepts a State chart heading with the no state change note", () => {
    expect(
      hasStateChartPart("### State chart\r\nNo state change: this PR changes only docs."),
    ).toBe(true)
  })

  test("rejects a mermaid chart with no State chart heading", () => {
    expect(hasStateChartPart("## Diagram\n\n```mermaid\nstateDiagram-v2\n```\n")).toBe(false)
  })

  test("rejects a State chart heading with no chart and no note", () => {
    expect(hasStateChartPart("## State chart\n\nTo do.\n")).toBe(false)
  })

  test("rejects the words State chart when they are not a heading", () => {
    expect(hasStateChartPart("See the State chart\n```mermaid\nstateDiagram-v2\n```\n")).toBe(false)
  })
})
