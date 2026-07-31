import { describe, expect, test } from "vitest"
import { type CliOptions, runCli as runCliBase } from "./run-cli.ts"

interface DictionaryCliOptions extends CliOptions {
  readonly dictionaryPath?: string
}

async function runCli(args: string[], options: DictionaryCliOptions = {}) {
  const originalDictionaryPath = process.env.SIMPLE_ENGLISH_DICTIONARY
  if (options.dictionaryPath === undefined) {
    delete process.env.SIMPLE_ENGLISH_DICTIONARY
  } else {
    process.env.SIMPLE_ENGLISH_DICTIONARY = options.dictionaryPath
  }

  const { dictionaryPath: _, ...cliOptions } = options
  try {
    return await runCliBase(args, cliOptions)
  } finally {
    if (originalDictionaryPath === undefined) {
      delete process.env.SIMPLE_ENGLISH_DICTIONARY
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

  test("exits 1 on progressive tense, a hard violation", async () => {
    const result = await runCli([], { stdin: "The pump is running." })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("<stdin>:1:10 verb-progressive")
    expect(result.stdout).toContain("Do not use the progressive")
  })

  test("prints passive voice but exits 0 because it is soft", async () => {
    const result = await runCli([], { stdin: "The bolt was removed." })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("<stdin>:1:10 verb-passive")
    expect(result.stdout).toContain("active voice")
  })

  test("uses the bundled dictionary and prints its approved alternative", async () => {
    const result = await runCli([], { stdin: "We attempt the repair." })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("<stdin>:1:4 dictionary-not-approved-word")
    expect(result.stdout).toContain('Use "try", not "attempt".')
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

  test("errors with exit code 2 on an unreadable file", async () => {
    const result = await runCli(["test/fixtures/does-not-exist.md"])

    expect(result.code).toBe(2)
    expect(result.stderr).toContain("does-not-exist.md")
  })
})
