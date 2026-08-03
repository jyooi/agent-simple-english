import { describe, expect, test } from "vitest"
import { blankMarkdownDestinations } from "../../src/engine/markdown.ts"

const parserThresholdPrefix = `${"Alphaword ".repeat(1_100)}\n\n`

const maskAfterThreshold = (markdown: string): string => {
  const source = `${parserThresholdPrefix}${markdown}`
  const masked = blankMarkdownDestinations(source.split("\n")).join("\n")
  expect(masked).toHaveLength(source.length)
  return masked.slice(parserThresholdPrefix.length)
}

describe("Markdown parser masking", () => {
  test("keeps heading prose while masking its syntax", () => {
    expect(maskAfterThreshold("# Betaword")).toBe("  Betaword")
  })

  test("retains invalid next-line definition titles", () => {
    expect(maskAfterThreshold('[target]: /path\n"Betaword"')).toBe('               \n"Betaword"')
    expect(maskAfterThreshold('- [target]: /path\n "Betaword"')).toBe(
      '                 \n "Betaword"',
    )
  })

  test("does not parse Markdown syntax inside HTML flow content", () => {
    expect(maskAfterThreshold("<div>\n[Alphaword](Betaword)\n</div>")).toBe(
      "     \n[Alphaword](Betaword)\n      ",
    )
  })

  test("masks definitions and angle-bracket resources consistently", () => {
    expect(maskAfterThreshold("[x]: /Betaword")).toBe("              ")
    expect(maskAfterThreshold('[a](<Destword> "Titleword")')).toBe(" a                         ")
  })

  test("uses virtual columns for definition titles after tabs", () => {
    const text = '-\t[target]: /path\n    "Betaword"'
    expect(maskAfterThreshold(text)).toBe('                 \n    "Betaword"')
  })

  test("retains link-like text that the parser does not classify as links", () => {
    const text = "Alphaword ](Betaword) and ](Gammaword)"
    expect(maskAfterThreshold(text)).toBe(text)
  })

  test("does not let shallow images make link-like prose into syntax", () => {
    const text = `${"![x](u) ".repeat(40)}\n\nAlphaword ](Betaword) and ](Gammaword)`
    expect(maskAfterThreshold(text).endsWith("Alphaword ](Betaword) and ](Gammaword)")).toBe(true)
  })

  test("does not let nested images make link-like prose into syntax", () => {
    expect(maskAfterThreshold("![![x](u)](v) Alphaword ](Betaword)")).toBe(
      "    x         Alphaword ](Betaword)",
    )
  })

  test("retains escaped angle-bracket prose", () => {
    expect(maskAfterThreshold(String.raw`\<Betaword>`)).toBe(" <Betaword>")
  })
})
