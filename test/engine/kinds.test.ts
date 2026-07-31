import { describe, expect, test } from "vitest"
import { lint } from "../../src/engine/lint.ts"

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i + 1}`).join(" ")

describe("lint slash-source: comment extraction", () => {
  test("flags a long sentence in a line comment, at the comment text position", () => {
    const text = ["const x = 1", `const y = 2 // ${words(30)}.`].join("\n")
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({
      ruleId: "sentence-length",
      line: 2,
      column: 16,
    })
  })

  test("never lints code outside comments", () => {
    const text = [`const sentence = call(${words(40)})`, `${words(40)}`].join("\n")

    expect(lint("slash-source", text).violations).toHaveLength(0)
  })

  test("a comment marker inside a string literal does not start a comment", () => {
    const text = `const url = "https://example.com/${words(30)}."`

    expect(lint("slash-source", text).violations).toHaveLength(0)
  })

  test("a trailing comment after a string containing slashes is still linted", () => {
    const text = `const url = "https://example.com" // ${words(30)}.`
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 1, column: 38 })
  })

  test("flags a long sentence spanning a block comment", () => {
    const text = ["const a = 1", `/* ${words(15)}`, `${words(15)}. */`, "const b = 2"].join("\n")
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 2, column: 4 })
  })

  test("strips the leading asterisk decoration of doc comment lines", () => {
    const text = ["/**", ` * ${words(15)}`, ` * ${words(15)}.`, " */"].join("\n")
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 2, column: 4 })
  })

  test("code between two block comments on one line is not linted", () => {
    const text = `/* short one. */ call(${words(30)}) /* another short. */`

    expect(lint("slash-source", text).violations).toHaveLength(0)
  })

  test("triple-slash doc comment markers are not part of the prose", () => {
    const text = `/// ${words(30)}.`
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 1, column: 5 })
  })

  test("does not lint comment markers inside multi-line template literals", () => {
    const text = ["const s = `first line", `// ${words(30)}.`, "`", `// ${words(30)}.`].join("\n")
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 4, column: 4 })
  })

  test("distinguishes Rust lifetimes from multi-line string literals", () => {
    const text = ["fn borrow(value: &'static str) {}", `// ${words(30)}.`].join("\n")
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 2, column: 4 })
  })

  test("keeps Java text blocks open across embedded quotes", () => {
    const text = [
      'String text = """',
      'embedded " quote',
      `// ${words(30)}.`,
      '""";',
      `// ${words(30)}.`,
    ].join("\n")
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 5, column: 4 })
  })

  test("does not lint comment markers inside C# verbatim strings", () => {
    const text = [
      'var value = @"first line',
      `// ${words(30)}.`,
      'embedded "" quote',
      '";',
      `// ${words(30)}.`,
    ].join("\n")
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 5, column: 4 })
  })

  test("does not lint comment markers inside Rust raw strings", () => {
    const text = [
      'let value = r##"first line',
      `// ${words(30)}.`,
      '"##;',
      `// ${words(30)}.`,
    ].join("\n")
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 4, column: 4 })
  })

  test("does not lint comment markers inside C++ raw strings", () => {
    const text = [
      'auto value = R"tag(first line',
      `// ${words(30)}.`,
      ')tag";',
      `// ${words(30)}.`,
    ].join("\n")
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 4, column: 4 })
  })

  test("applies Markdown fences after extracting doc comments", () => {
    const text = ["/// ```text", `/// ${words(30)}.`, "/// ```", `/// ${words(30)}.`].join("\n")
    const report = lint("slash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 4, column: 5 })
  })
})

describe("lint hash-source: comment extraction", () => {
  test("flags a long sentence in a hash comment", () => {
    const text = ["x = 1", `# ${words(30)}.`].join("\n")
    const report = lint("hash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 2, column: 3 })
  })

  test("flags a long trailing comment at its position in the original line", () => {
    const text = `x = compute()  # ${words(30)}.`
    const report = lint("hash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 1, column: 18 })
  })

  test("a hash inside a string literal does not start a comment", () => {
    const text = `color = "#fffff ${words(30)}."`

    expect(lint("hash-source", text).violations).toHaveLength(0)
  })

  test("a shebang line is not prose", () => {
    const text = [`#!/usr/bin/env bash ${words(30)}.`, "echo hi"].join("\n")

    expect(lint("hash-source", text).violations).toHaveLength(0)
  })

  test("never lints code outside comments", () => {
    const text = `run ${words(40)}.`

    expect(lint("hash-source", text).violations).toHaveLength(0)
  })

  test("does not lint comment markers inside multi-line string literals", () => {
    const text = ['value = """first line', `# ${words(30)}.`, '"""', `# ${words(30)}.`].join("\n")
    const report = lint("hash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 4, column: 3 })
  })

  test("does not treat a shell parameter operator as a comment", () => {
    const text = `trimmed=\${name#${words(30)}}`

    expect(lint("hash-source", text, { sourceDialect: "shell" }).violations).toHaveLength(0)
  })

  test("does not treat a mid-token shell hash as a comment", () => {
    const text = `echo prefix# ${words(30)}.`

    expect(lint("hash-source", text, { sourceDialect: "shell" }).violations).toHaveLength(0)
  })

  test("recognizes a trailing comment without leading whitespace", () => {
    const text = `x=1# ${words(30)}.`
    const report = lint("hash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 1, column: 6 })
  })

  test("does not lint hash markers in shell heredoc payloads", () => {
    const text = ["cat <<'EOF'", `# ${words(30)}.`, "EOF", `# ${words(30)}.`].join("\n")
    const report = lint("hash-source", text, { sourceDialect: "shell" })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 4, column: 3 })
  })

  test("does not infer a shell heredoc from Python shift syntax", () => {
    const text = ["result = value << LIMIT", `# ${words(30)}.`].join("\n")
    const report = lint("hash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 2, column: 3 })
  })

  test("recognizes numeric shell heredocs and CRLF terminators", () => {
    const text = ["cat <<123\r", `# ${words(30)}.\r`, "123\r", `# ${words(30)}.`].join("\n")
    const report = lint("hash-source", text, { sourceDialect: "shell" })

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 4, column: 3 })
  })

  test("applies Markdown indented blocks after extracting comments", () => {
    const text = ["# Intro.", "#", `#     ${words(30)}.`, "#", `# ${words(30)}.`].join("\n")
    const report = lint("hash-source", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 5, column: 3 })
  })
})

describe("lint commit-message", () => {
  test("lints the full message text", () => {
    const text = ["feat: short subject", "", `${words(30)}.`].join("\n")
    const report = lint("commit-message", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 3, column: 1 })
  })

  test("a clean message passes", () => {
    const text = ["fix: remove the bolt", "", "Turn the handle to the left."].join("\n")

    expect(lint("commit-message", text).violations).toHaveLength(0)
  })

  test("does not lint Markdown inline code", () => {
    const text = `Run \`${words(30)}\` to update the file.`

    expect(lint("commit-message", text).violations).toHaveLength(0)
  })
})

describe("identifier exemption", () => {
  test("identifiers in comments never count as prose words", () => {
    const identifiers = Array.from({ length: 12 }, () => "doNotUse").join(" ")
    const text = `// ${words(20)} ${identifiers}.`

    expect(lint("slash-source", text).violations).toHaveLength(0)
  })

  test("snake_case and dotted identifiers are exempt in prose files", () => {
    const identifiers = Array.from({ length: 12 }, () => "config.max_value").join(" ")
    const text = `${words(20)} ${identifiers}.`

    expect(lint("prose-file", text).violations).toHaveLength(0)
  })

  test("identifiers are exempt in commit messages", () => {
    const identifiers = Array.from({ length: 12 }, () => "handle_input()").join(" ")
    const text = `${words(20)} ${identifiers}.`

    expect(lint("commit-message", text).violations).toHaveLength(0)
  })

  test("plain function calls are exempt in prose", () => {
    const identifiers = Array.from({ length: 12 }, () => "parse()").join(" ")
    const text = `${words(20)} ${identifiers}.`

    expect(lint("prose-file", text).violations).toHaveLength(0)
  })

  test("plain words still count", () => {
    expect(lint("commit-message", `${words(26)}.`).violations).toHaveLength(1)
  })
})

describe("lint prose-file: hardened markdown stripping", () => {
  test("inline code spans never produce violations", () => {
    const text = `Run \`${words(30)}\` to start.`

    expect(lint("prose-file", text).violations).toHaveLength(0)
  })

  test("indented code blocks never produce violations", () => {
    const text = ["A short sentence.", "", `    ${words(40)}.`, "", "Another one."].join("\n")

    expect(lint("prose-file", text).violations).toHaveLength(0)
  })

  test("inline code spans can cross line boundaries", () => {
    const text = ["Run `the command", `${words(30)}`, "to finish` now."].join("\n")

    expect(lint("prose-file", text).violations).toHaveLength(0)
  })

  test("a tilde fence is not closed by a backtick fence", () => {
    const text = ["~~~", "```", `${words(40)}.`, "~~~"].join("\n")

    expect(lint("prose-file", text).violations).toHaveLength(0)
  })

  test("a fence marker with trailing text does not close a fence", () => {
    const text = ["~~~", "~~~not-a-close", `${words(40)}.`, "~~~", `${words(30)}.`].join("\n")
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 5, column: 1 })
  })

  test("prose after an indented code block is still flagged with the correct position", () => {
    const text = ["Intro.", "", `    code(${words(30)})`, "", `${words(30)}.`].join("\n")
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 5, column: 1 })
  })

  test("recognizes fenced code inside blockquote containers", () => {
    const text = ["> ```text", `> ${words(30)}.`, "> ```", `${words(30)}.`].join("\n")
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 4, column: 1 })
  })

  test("recognizes indented code inside blockquote containers", () => {
    const text = ["> Intro.", ">", `>     ${words(30)}.`, ">", `${words(30)}.`].join("\n")
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 5, column: 1 })
  })

  test("ends an unclosed fence when its blockquote container ends", () => {
    const text = ["> ~~~", `> ${words(30)}.`, `${words(30)}.`].join("\n")
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 3, column: 1 })
  })

  test("recognizes fenced code inside list containers", () => {
    const text = ["- ~~~", `  ${words(30)}.`, "  ~~~", `${words(30)}.`].join("\n")
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 4, column: 1 })
  })

  test("ends an unclosed fence when its list container ends", () => {
    const text = ["- ~~~", `  ${words(30)}.`, `${words(30)}.`].join("\n")
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 3, column: 1 })
  })

  test("does not pair unmatched backtick runs of different lengths", () => {
    const text = `\` \`\` ${words(30)}.`
    const report = lint("prose-file", text)

    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]).toMatchObject({ line: 1, column: 1 })
  })
})
