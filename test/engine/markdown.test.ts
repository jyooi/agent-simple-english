import { describe, expect, test } from "vitest"
import {
  blankMarkdownCode,
  blankMarkdownDestinations,
} from "../../src/engine/markdown.ts"

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

  test("masks the parser-classified empty resource after link-like prose", () => {
    const prefix = "Alphaword ".repeat(6_000)
    const text = `${prefix}Alphaword ]() before [x]()`
    const masked = blankMarkdownDestinations([text])[0]

    expect(masked).toBe(`${prefix}Alphaword ]() before  x   `)
  })

  test.each(["> [x]: /private", "- [x]: /private"])(
    "resolves definitions in Markdown containers: %s",
    (definition) => {
      expect(maskAfterThreshold(`${definition}\n\n[text][x]`)).toBe(
        `${" ".repeat(definition.length)}\n\n text    `,
      )
    },
  )

  test("accepts labels at the CommonMark size limit", () => {
    const text = `[${"x".repeat(999)}]: /Betaword`

    expect(maskAfterThreshold(text)).toBe(" ".repeat(text.length))
  })

  test("retains labels beyond the CommonMark size limit", () => {
    const label = "x".repeat(1_000)
    const text = `[${label}]: /Betaword`

    expect(maskAfterThreshold(text)).toBe(text)
  })

  test("retains unknown character references as prose", () => {
    expect(maskAfterThreshold("Alphaword &Betaword;")).toBe("Alphaword &Betaword;")
  })

  test.each([
    ["comment", "<!--\nBetaword\n-->", ["    ", "        ", "   "]],
    ["processing instruction", "<?target\nBetaword\n?>", ["        ", "        ", "  "]],
  ])("masks multiline HTML %s blocks", (_name, input, expected) => {
    expect(blankMarkdownDestinations(input.split("\n"))).toEqual(expected)
  })

  test("retains prose after a closed raw-content block", () => {
    const input = "<textarea>\nBetaword\n</textarea>\nAlphaword"

    expect(blankMarkdownDestinations(input.split("\n"))).toEqual([
      " ".repeat(10),
      " ".repeat(8),
      " ".repeat(11),
      "Alphaword",
    ])
  })

  test("does not mistake a slash in a quoted attribute for a self-closing tag", () => {
    const input = '<script data="/>">\nBetaword\n</script>'

    expect(blankMarkdownDestinations(input.split("\n"))).toEqual([
      " ".repeat(18),
      " ".repeat(8),
      " ".repeat(9),
    ])
  })

  test("uses the complete grammar when link destinations contain backticks", () => {
    const input = "[Alpha](target`) Betaword `"

    expect(blankMarkdownCode([input])).toEqual([input])
  })

  test("masks parser-classified malformed raw-content blocks", () => {
    const input = "<script =bad>\nBetaword\n</script>"

    expect(blankMarkdownDestinations(input.split("\n"))).toEqual([
      " ".repeat(13),
      " ".repeat(8),
      " ".repeat(9),
    ])
  })

  test("retains prose after a self-closing raw-content tag name", () => {
    const input = "<script/>\nBetaword"

    expect(blankMarkdownDestinations(input.split("\n"))).toEqual([
      " ".repeat(9),
      "Betaword",
    ])
  })

  test("masks HTML tags inside code-like HTML flow content", () => {
    const input = "<div>\n`<span>`\n</div>"

    expect(blankMarkdownDestinations(input.split("\n"))).toEqual([
      " ".repeat(5),
      `\`${" ".repeat(6)}\``,
      " ".repeat(6),
    ])
  })

  test("keeps parser offsets aligned after a byte order mark", () => {
    expect(blankMarkdownCode(["\ufeff`Betaword`"])).toEqual([`\ufeff${" ".repeat(10)}`])
  })

  test("masks self-closing syntax in a parser-classified raw-content block", () => {
    const input = '<script data=">"/>\nBetaword'

    expect(blankMarkdownDestinations(input.split("\n"))).toEqual([
      " ".repeat(18),
      " ".repeat(8),
    ])
  })
})
