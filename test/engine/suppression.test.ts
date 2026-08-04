import { describe, expect, test } from "vitest"
import { classifyPath } from "../../src/engine/kinds.ts"
import { lint } from "../../src/engine/lint.ts"

describe("lint: inline suppression directives", () => {
  test("a Markdown directive suppresses one named rule on the next line only", () => {
    const text = [
      "<!-- ste-disable-next-line marketing -->",
      "The robust method works.",
      "The robust process works.",
    ].join("\n")

    const report = lint("prose-file", text)

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "marketing", line: 3, column: 5 }),
    ])
  })

  test("other rules on the target line still report", () => {
    const text = [
      "<!-- ste-disable-next-line marketing -->",
      "The robust method isn't ready.",
    ].join("\n")

    const report = lint("prose-file", text)

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "contraction", line: 2, column: 19 }),
    ])
    expect(report.summary).toEqual({ total: 1, hard: 1 })
  })

  test("whitespace and comma separators can name multiple rules", () => {
    const whitespace = lint(
      "prose-file",
      [
        "<!-- ste-disable-next-line marketing contraction -->",
        "The robust method isn't ready.",
      ].join("\n"),
    )
    const commas = lint(
      "prose-file",
      [
        "<!-- ste-disable-next-line marketing, contraction -->",
        "The robust method isn't ready.",
      ].join("\n"),
    )

    expect(whitespace.violations).toHaveLength(0)
    expect(whitespace.summary).toEqual({ total: 0, hard: 0 })
    expect(commas.violations).toHaveLength(0)
  })

  test.each([
    ["slash-source" as const, "//"],
    ["hash-source" as const, "#"],
  ])("a plain %s comment directive suppresses the next source comment", (kind, marker) => {
    const text = [
      `${marker} ste-disable-next-line marketing`,
      `${marker} The robust method works.`,
      `${marker} The robust process works.`,
    ].join("\n")

    const report = lint(kind, text)

    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: "marketing",
        line: 3,
        column: marker === "//" ? 8 : 7,
      }),
    ])
  })

  test("a Markdown directive inside an HTML flow suppresses the next line", () => {
    const text = [
      "<div>",
      "<!-- ste-disable-next-line marketing -->",
      "The robust method works.",
      "</div>",
    ].join("\n")

    expect(lint("prose-file", text).violations).toHaveLength(0)
  })

  test("a Markdown directive beside HTML tags is validated", () => {
    const text = "<div><!-- ste-disable-next-line unknown --></div>\nA short sentence."

    expect(lint("prose-file", text).violations).toEqual([
      expect.objectContaining({ ruleId: "invalid-suppression", line: 1, column: 6 }),
    ])
  })

  test("a Markdown directive inside a blockquoted HTML flow suppresses the next line", () => {
    const text = [
      "> <div>",
      "> <!-- ste-disable-next-line marketing -->",
      "> The robust method works.",
      "> </div>",
    ].join("\n")

    expect(lint("prose-file", text).violations).toHaveLength(0)
  })

  test.each([
    ["> ", "> "],
    ["- ", "- "],
  ])("a Markdown directive works inside a container: %s", (directivePrefix, prosePrefix) => {
    const text = [
      `${directivePrefix}<!-- ste-disable-next-line marketing -->`,
      `${prosePrefix}The robust method works.`,
    ].join("\n")

    expect(lint("prose-file", text).violations).toHaveLength(0)
  })

  test.each([
    ["slash-source" as const, "const value = 1 // ste-disable-next-line marketing", "//"],
    ["hash-source" as const, "value = 1 # ste-disable-next-line marketing", "#"],
  ])("a trailing %s directive suppresses the next source comment", (kind, directive, marker) => {
    const text = [directive, `${marker} The robust method works.`].join("\n")

    expect(lint(kind, text).violations).toHaveLength(0)
  })

  test("a slash directive after a block comment suppresses the next source comment", () => {
    const text = [
      "/**/ // ste-disable-next-line marketing",
      "// The robust method works.",
    ].join("\n")

    expect(lint("slash-source", text).violations).toHaveLength(0)
  })

  test.each(["yaml", "yml"])(
    "directive text inside a .%s block scalar is not a hash comment",
    (extension) => {
      const classification = classifyPath(`example.${extension}`)
      const text = [
        "text: |",
        " # ste-disable-next-line unknown",
        "# ste-disable-next-line marketing",
        "# The robust method works.",
      ].join("\n")

      expect(classification).toEqual({ kind: "hash-source", sourceDialect: "yaml" })
      expect(
        lint(classification.kind, text, { sourceDialect: classification.sourceDialect }).violations,
      ).toHaveLength(0)
    },
  )

  test("an apostrophe in a plain YAML scalar does not hide a later directive", () => {
    const text = "message: it's fine\n# ste-disable-next-line unknown"

    expect(lint("hash-source", text, { sourceDialect: "yaml" }).violations).toEqual([
      expect.objectContaining({ ruleId: "invalid-suppression", line: 2, column: 1 }),
    ])
  })

  test.each([
    ["plain", "url: https://example.com/#ste-disable-next-line unknown"],
    [
      "double-quoted multiline",
      ['text: "first line', "  # ste-disable-next-line unknown", '  last line"'].join("\n"),
    ],
    [
      "single-quoted multiline",
      ["text: 'first line", "  # ste-disable-next-line unknown", "  last line'"].join("\n"),
    ],
  ])("directive text inside a %s YAML scalar is not a hash comment", (_kind, scalar) => {
    const text = [
      scalar,
      "# ste-disable-next-line marketing",
      "# The robust method works.",
    ].join("\n")

    expect(lint("hash-source", text, { sourceDialect: "yaml" }).violations).toHaveLength(0)
  })

  test("a directive in an indented code block does not suppress prose", () => {
    const text = ["    <!-- ste-disable-next-line marketing -->", "The robust method works."].join(
      "\n",
    )

    expect(lint("prose-file", text).violations).toEqual([
      expect.objectContaining({ ruleId: "marketing", line: 2, column: 5 }),
    ])
  })

  test("an unknown rule id reports one hard invalid-suppression violation", () => {
    const text = [
      "<!-- ste-disable-next-line marketing unknown-rule another-unknown -->",
      "The robust method works.",
    ].join("\n")

    const report = lint("prose-file", text)

    expect(report.violations).toEqual([
      {
        ruleId: "invalid-suppression",
        severity: "hard",
        line: 1,
        column: 1,
        message: 'Suppression directive names unknown rule ids: "unknown-rule", "another-unknown".',
      },
    ])
    expect(report.summary).toEqual({ total: 1, hard: 1 })
  })

  test("a directive with no rule id reports the invalid-suppression violation", () => {
    const report = lint("prose-file", "<!-- ste-disable-next-line -->\nA short sentence.")

    expect(report.violations).toEqual([
      {
        ruleId: "invalid-suppression",
        severity: "hard",
        line: 1,
        column: 1,
        message: "Suppression directive must name at least one rule id.",
      },
    ])
  })

  test("a directive after a byte order mark reports its source column", () => {
    const report = lint(
      "prose-file",
      "\uFEFF<!-- ste-disable-next-line unknown -->\nA short sentence.",
    )

    expect(report.violations).toEqual([
      expect.objectContaining({ ruleId: "invalid-suppression", line: 1, column: 2 }),
    ])
  })

  test.each([
    ["slash-source" as const, "// ste-disable-next-line"],
    ["hash-source" as const, "# ste-disable-next-line"],
  ])("a %s directive with no rule id reports the same violation", (kind, directive) => {
    expect(lint(kind, `${directive}\nA short sentence.`).violations).toEqual([
      expect.objectContaining({
        ruleId: "invalid-suppression",
        severity: "hard",
        line: 1,
        column: 1,
      }),
    ])
  })

  test("the invalid-suppression rule can be configured", () => {
    const report = lint("prose-file", "<!-- ste-disable-next-line unknown -->\nA short sentence.", {
      rules: { "invalid-suppression": "off" },
    })

    expect(report.violations).toHaveLength(0)
  })

  test("a directive applies to the next physical line, including a blank line", () => {
    const text = ["<!-- ste-disable-next-line marketing -->", "", "The robust method works."].join(
      "\n",
    )

    expect(lint("prose-file", text).violations).toEqual([
      expect.objectContaining({ ruleId: "marketing", line: 3, column: 5 }),
    ])
  })

  test("plain directive text without the comment form does not suppress", () => {
    const text = ["ste-disable-next-line marketing", "The robust method works."].join("\n")

    expect(lint("prose-file", text).violations).toEqual([
      expect.objectContaining({ ruleId: "marketing", line: 2, column: 5 }),
    ])
  })

  test("suppression applies before previous-text diff gating", () => {
    const previousText = "The stable method works."
    const text = ["<!-- ste-disable-next-line marketing -->", "The robust method works."].join("\n")

    expect(lint("prose-file", text, { previousText }).violations).toHaveLength(0)
  })

  test("removing a directive reports the finding that it suppressed", () => {
    const previousText = [
      "<!-- ste-disable-next-line marketing -->",
      "The robust method works.",
    ].join("\n")
    const text = "The robust method works."

    expect(lint("prose-file", text, { previousText }).violations).toEqual([
      expect.objectContaining({ ruleId: "marketing", line: 1, column: 5 }),
    ])
  })
})
