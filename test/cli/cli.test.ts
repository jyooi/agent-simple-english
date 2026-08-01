import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { type CliOptions, repoRoot, runCli as runCliBase } from "./run-cli.ts"

const fixturesPath = fileURLToPath(new URL("../fixtures", import.meta.url))

interface DictionaryCliOptions extends CliOptions {
  readonly dictionaryPath?: string
}

async function runCli(args: string[], options: DictionaryCliOptions = {}) {
  const originalDictionaryPath = process.env.SIMPLE_ENGLISH_DICTIONARY
  if (options.dictionaryPath === undefined) {
    Reflect.deleteProperty(process.env, "SIMPLE_ENGLISH_DICTIONARY")
  } else {
    process.env.SIMPLE_ENGLISH_DICTIONARY = options.dictionaryPath
  }

  const { dictionaryPath: _, ...cliOptions } = options
  try {
    return await runCliBase(args, cliOptions)
  } finally {
    if (originalDictionaryPath === undefined) {
      Reflect.deleteProperty(process.env, "SIMPLE_ENGLISH_DICTIONARY")
    } else {
      process.env.SIMPLE_ENGLISH_DICTIONARY = originalDictionaryPath
    }
  }
}

describe("simple-english CLI", () => {
  test("exits 0 on a clean file", async () => {
    const result = await runCli(["test/fixtures/clean.md"])

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe("")
  })

  test("exits 1 and prints violations with line, column, and rule id for a file", async () => {
    const result = await runCli(["test/fixtures/violations.md"])

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("test/fixtures/violations.md:3:1")
    expect(result.stdout).toContain("sentence-length")
    expect(result.stdout).toContain("maximum is 25")
  })

  test("lints stdin when no paths are given", async () => {
    const longSentence = `${Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")}.`
    const result = await runCli([], { stdin: longSentence })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("<stdin>:1:1")
    expect(result.stdout).toContain("sentence-length")
  })

  test("exits 0 on clean stdin", async () => {
    const result = await runCli([], { stdin: "A short sentence." })

    expect(result.code).toBe(0)
  })

  test("--json emits a stable machine-readable report", async () => {
    const result = await runCli(["--json", "test/fixtures/violations.md"])

    expect(result.code).toBe(1)
    const report = JSON.parse(result.stdout)
    expect(report).toEqual({
      violations: [
        {
          file: "test/fixtures/violations.md",
          ruleId: "sentence-length",
          severity: "hard",
          message: expect.stringContaining("maximum is 25"),
          line: 3,
          column: 1,
        },
      ],
      summary: { total: 1, hard: 1 },
    })
  })

  test("--json on clean input emits an empty report and exits 0", async () => {
    const result = await runCli(["--json"], { stdin: "A short sentence." })

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      violations: [],
      summary: { total: 0, hard: 0 },
    })
  })

  test("rejects an unknown flag with exit code 2", async () => {
    const result = await runCli(["--unknown"])

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('unknown flag "--unknown"')
    expect(result.stderr).not.toContain("cannot read --unknown")
  })

  test("--help prints usage and exits 0", async () => {
    const result = await runCli(["--help"])

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("Usage: simple-english")
    expect(result.stdout).toContain("--config <path>")
    expect(result.stderr).toBe("")
  })

  test("--version prints the package version and exits 0", async () => {
    const packageManifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
      version: string
    }
    const result = await runCli(["--version"])

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe(packageManifest.version)
    expect(result.stderr).toBe("")
  })

  test("exits 1 on progressive tense, a hard violation", async () => {
    const result = await runCli([], { stdin: "The pump is running." })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("<stdin>:1:10 [hard] verb-progressive")
    expect(result.stdout).toContain("Do not use the progressive")
  })

  test("prints passive voice but exits 0 because it is soft", async () => {
    const result = await runCli([], { stdin: "The bolt was removed." })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("<stdin>:1:10 [soft] verb-passive")
    expect(result.stdout).toContain("active voice")
  })

  test("uses the bundled dictionary and prints its approved alternative", async () => {
    const result = await runCli([], { stdin: "We attempt the repair." })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("<stdin>:1:4 [hard] dictionary-not-approved-word")
    expect(result.stdout).toContain('Use "try", not "attempt".')
  })

  test("loads and matches a hyphenated dictionary form", async () => {
    const result = await runCli([], {
      stdin: "Use state-of-the-art parts.",
      dictionaryPath: "test/fixtures/hyphenated-dictionary.json",
    })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain('Use "advanced", not "state-of-the-art".')
  })

  test("accepts an approved alternative and a word used as an allowed POS", async () => {
    const result = await runCli([], { stdin: "We try the repair. The attempt failed." })

    expect(result.code).toBe(0)
    expect(result.stdout).toBe("")
  })

  test("uses word-level fallback for bundled entries without POS metadata", async () => {
    const result = await runCli([], { stdin: "It is approximately five millimeters." })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain('Use "about", not "approximately".')
  })

  test.each([
    ["invalid", "test/fixtures/invalid-dictionary.json", "entries[0].unapproved"],
    ["unknown-property", "test/fixtures/unknown-dictionary-property.json", "partOfSpeech"],
    [
      "unsupported-form",
      "test/fixtures/unsupported-dictionary-form.json",
      "entries[0].unapproved[0]",
    ],
    ["unreadable", "test/fixtures/missing-dictionary.json", "cannot read file"],
  ])("reports an %s dictionary and continues other rules", async (_kind, path, error) => {
    const longSentence = `${Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ")}.`
    const input = [
      longSentence,
      "The pump is running.",
      "The technician has finished the task.",
      "The bolt was removed.",
    ].join("\n")
    const result = await runCli([], { stdin: input, dictionaryPath: path })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Cannot load STE dictionary")
    expect(result.stderr).toContain(error)
    expect(result.stdout).toContain("sentence-length")
    expect(result.stdout).toContain("verb-progressive")
    expect(result.stdout).toContain("verb-perfect")
    expect(result.stdout).toContain("verb-passive")
  })

  test("human output shows the severity of each violation", async () => {
    const result = await runCli(["test/fixtures/violations.md"])

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("[hard] sentence-length")
  })

  test("soft violations appear in the output but exit 0", async () => {
    const result = await runCli([], { stdin: "This is a seamless flow." })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("[soft] marketing")
    expect(result.stdout).toContain("seamless")
  })

  test("--json reports severity and the phrasal-verb suggestion", async () => {
    const result = await runCli(["--json"], {
      stdin: "Carry out the test. It is a seamless flow.",
    })

    expect(result.code).toBe(1)
    const report = JSON.parse(result.stdout)
    expect(report.summary).toEqual({ total: 2, hard: 1 })
    expect(report.violations).toEqual([
      expect.objectContaining({
        ruleId: "phrasal-verb",
        severity: "hard",
        suggestion: "do",
      }),
      expect.objectContaining({ ruleId: "marketing", severity: "soft" }),
    ])
  })

  test("maps .ts to slash-source: flags only the comment, not the string literal", async () => {
    const result = await runCli(["test/fixtures/comment-violation.ts"])

    expect(result.code).toBe(1)
    const lines = result.stdout.trim().split("\n")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("test/fixtures/comment-violation.ts:2:4")
    expect(lines[0]).toContain("sentence-length")
  })

  test("maps .sh to hash-source: flags only the comment, not the string literal", async () => {
    const result = await runCli(["test/fixtures/comment-violation.sh"])

    expect(result.code).toBe(1)
    const lines = result.stdout.trim().split("\n")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("test/fixtures/comment-violation.sh:4:3")
  })

  test("--kind commit-message lints the full stdin text", async () => {
    const message = [
      "feat: add the widget",
      "",
      `${Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")}.`,
    ].join("\n")
    const result = await runCli(["--kind", "commit-message"], { stdin: message })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("<stdin>:3:1")
  })

  test("--kind overrides the extension mapping", async () => {
    const longSentence = `${Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")}.`

    const asProse = await runCli([], { stdin: longSentence })
    expect(asProse.code).toBe(1)

    const asSlashSource = await runCli(["--kind", "slash-source"], { stdin: longSentence })
    expect(asSlashSource.code).toBe(0)
    expect(asSlashSource.stdout.trim()).toBe("")
  })

  test("rejects an unknown kind with exit code 2", async () => {
    const result = await runCli(["--kind", "nonsense"], { stdin: "Short." })

    expect(result.code).toBe(2)
    expect(result.stderr).toContain("nonsense")
  })

  test("rejects --kind without a value with exit code 2", async () => {
    const result = await runCli(["--kind"], { stdin: "Short." })

    expect(result.code).toBe(2)
    expect(result.stderr).toContain("--kind requires a value")
  })

  test("rejects an option token as a --kind value", async () => {
    const result = await runCli(["--kind", "--json"], { stdin: "Short." })

    expect(result.code).toBe(2)
    expect(result.stderr).toContain("--kind requires a value")
  })

  test("maps a dotless path to prose-file, not a source kind", async () => {
    const result = await runCli(["go"], { cwd: fixturesPath })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("go:1:1")
    expect(result.stdout).toContain("sentence-length")
  })

  test("errors with exit code 2 on an unreadable file", async () => {
    const result = await runCli(["test/fixtures/does-not-exist.md"])

    expect(result.code).toBe(2)
    expect(result.stderr).toContain("does-not-exist.md")
  })
})
