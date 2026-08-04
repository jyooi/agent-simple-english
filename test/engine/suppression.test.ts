import { describe, expect, test } from "vitest"
import { classifyPath } from "../../src/engine/kinds.ts"
import { lint } from "../../src/engine/lint.ts"

interface SuppressionVerdict {
  readonly name: string
  readonly text: string
  readonly expectedRuleIds: readonly string[]
  readonly note: string
}

interface SourceSuppressionVerdict extends SuppressionVerdict {
  readonly path: string
}

const sourceSuppressionVerdicts: readonly SourceSuppressionVerdict[] = [
  {
    name: "JavaScript regexp inside a template expression",
    path: "example.js",
    text: "const value = `${/}/.test(input)\n// ste-disable-next-line unknown\n}`",
    expectedRuleIds: [],
    note: "accepted false negative pending a JavaScript lexer",
  },
  {
    name: "Ruby regexp literal",
    path: "example.rb",
    text: "pattern = /# ste-disable-next-line unknown/",
    expectedRuleIds: ["invalid-suppression"],
    note: "accepted false positive pending a Ruby lexer",
  },
  {
    name: "Perl quote-like regexp literal",
    path: "example.pl",
    text: "my $pattern = qr/# ste-disable-next-line unknown/;",
    expectedRuleIds: ["invalid-suppression"],
    note: "accepted false positive pending a Perl lexer",
  },
  {
    name: "Perl indented heredoc",
    path: "example.pl",
    text: "my $message = <<~'TEXT';\nscalar\nTEXT\n# ste-disable-next-line unknown",
    expectedRuleIds: [],
    note: "accepted false negative pending a Perl lexer",
  },
]

const yamlSuppressionVerdicts: readonly SuppressionVerdict[] = [
  {
    name: "adjacent flow quoted scalar",
    text: '{"key":"first\n # ste-disable-next-line unknown\n last"}',
    expectedRuleIds: ["invalid-suppression"],
    note: "accepted false positive pending a YAML tokenizer",
  },
  {
    name: "compact nested explicit indentation",
    text: "- - |2\n scalar\n # ste-disable-next-line unknown",
    expectedRuleIds: ["invalid-suppression"],
    note: "accepted parserless verdict pending a YAML tokenizer",
  },
]

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
    const text = ["/**/ // ste-disable-next-line marketing", "// The robust method works."].join(
      "\n",
    )

    expect(lint("slash-source", text).violations).toHaveLength(0)
  })

  test("a directive inside a JavaScript template expression is validated", () => {
    const classification = classifyPath("example.js")
    const text = "const value = `${input\n// ste-disable-next-line unknown\n}`"

    expect(
      lint(classification.kind, text, { sourceDialect: classification.sourceDialect }).violations,
    ).toEqual([expect.objectContaining({ ruleId: "invalid-suppression", line: 2, column: 1 })])
  })

  test.each(["rs", "swift", "kt", "scala"])(
    "directive text inside a nested .%s block comment is not a line comment",
    (extension) => {
      const classification = classifyPath(`example.${extension}`)
      const text = "/* outer /* inner */\n// ste-disable-next-line unknown\n*/"

      expect(
        lint(classification.kind, text, { sourceDialect: classification.sourceDialect }).violations,
      ).toHaveLength(0)
    },
  )

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
    ["double-quoted string", 'message = "first\n# ste-disable-next-line unknown\nlast"'],
    ["single-quoted string", "message = 'first\n# ste-disable-next-line unknown\nlast'"],
    ["heredoc", "message = <<~TEXT\n# ste-disable-next-line unknown\nTEXT"],
    ["percent regex", "message = %r{# ste-disable-next-line unknown}"],
  ])("directive text inside a Ruby %s is not a hash comment", (_kind, scalar) => {
    const classification = classifyPath("example.rb")
    const text = `${scalar}\n# ste-disable-next-line unknown`

    expect(classification).toEqual({ kind: "hash-source", sourceDialect: "ruby" })
    expect(
      lint(classification.kind, text, { sourceDialect: classification.sourceDialect }).violations,
    ).toEqual([
      expect.objectContaining({
        ruleId: "invalid-suppression",
        line: scalar.split("\n").length + 1,
        column: 1,
      }),
    ])
  })

  test("directive text inside a Perl heredoc is not a hash comment", () => {
    const classification = classifyPath("example.pl")
    const text = "my $message = <<'TEXT';\n# ste-disable-next-line unknown\nTEXT"

    expect(
      lint(classification.kind, text, { sourceDialect: classification.sourceDialect }).violations,
    ).toHaveLength(0)
  })

  test.each([
    ["double-quoted", '- - "first\n # ste-disable-next-line unknown\n last"'],
    ["block", "- - |\n # ste-disable-next-line unknown"],
  ])(
    "directive text inside a compact nested %s YAML scalar is not a hash comment",
    (_kind, text) => {
      expect(lint("hash-source", text, { sourceDialect: "yaml" }).violations).toHaveLength(0)
    },
  )

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
    const text = [scalar, "# ste-disable-next-line marketing", "# The robust method works."].join(
      "\n",
    )

    expect(lint("hash-source", text, { sourceDialect: "yaml" }).violations).toHaveLength(0)
  })

  describe("pinned source suppression lexer verdicts", () => {
    for (const fixture of sourceSuppressionVerdicts) {
      test(`${fixture.name}: ${fixture.note}`, () => {
        const classification = classifyPath(fixture.path)
        const ruleIds = lint(classification.kind, fixture.text, {
          sourceDialect: classification.sourceDialect,
        }).violations.map((violation) => violation.ruleId)

        expect(ruleIds).toEqual(fixture.expectedRuleIds)
      })
    }
  })

  describe("pinned YAML suppression verdicts", () => {
    for (const fixture of yamlSuppressionVerdicts) {
      test(`${fixture.name}: ${fixture.note}`, () => {
        const ruleIds = lint("hash-source", fixture.text, {
          sourceDialect: "yaml",
        }).violations.map((violation) => violation.ruleId)

        expect(ruleIds).toEqual(fixture.expectedRuleIds)
      })
    }
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
        snippet: "<!-- ste-disable-next-line marketing unknown-rule another-unknown -->",
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
        snippet: "<!-- ste-disable-next-line -->",
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

  test.each([
    [
      "slash-source" as const,
      "const old = 1 // ste-disable-next-line unknown",
      "const new = 1 // ste-disable-next-line unknown",
    ],
    [
      "hash-source" as const,
      "value = old # ste-disable-next-line unknown",
      "value = new # ste-disable-next-line unknown",
    ],
    [
      "prose-file" as const,
      '<div class="old"><!-- ste-disable-next-line unknown --></div>',
      '<div class="new"><!-- ste-disable-next-line unknown --></div>',
    ],
  ])(
    "editing text outside an invalid %s directive does not report it again",
    (kind, previousText, text) => {
      expect(lint(kind, text, { previousText }).violations).toHaveLength(0)
    },
  )

  test("editing an invalid directive reports the changed finding", () => {
    const previousText = "const value = 1 // ste-disable-next-line old-rule"
    const text = "const value = 1 // ste-disable-next-line new-rule"

    expect(lint("slash-source", text, { previousText }).violations).toEqual([
      expect.objectContaining({
        ruleId: "invalid-suppression",
        message: 'Suppression directive names unknown rule ids: "new-rule".',
      }),
    ])
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
