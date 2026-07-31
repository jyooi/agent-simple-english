import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const repoRoot = fileURLToPath(new URL("../..", import.meta.url))

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

async function runCli(args: string[], stdin?: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "bun",
      ["src/cli/main.ts", ...args],
      { cwd: repoRoot },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : 0
        if (error && typeof error.code !== "number") {
          reject(error)
          return
        }
        resolve({ code, stdout, stderr })
      },
    )
    if (stdin !== undefined) {
      child.stdin?.write(stdin)
    }
    child.stdin?.end()
  })
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
    const result = await runCli([], longSentence)

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("<stdin>:1:1")
    expect(result.stdout).toContain("sentence-length")
  })

  test("exits 0 on clean stdin", async () => {
    const result = await runCli([], "A short sentence.")

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
    const result = await runCli(["--json"], "A short sentence.")

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      violations: [],
      summary: { total: 0, hard: 0 },
    })
  })

  test("errors with exit code 2 on an unreadable file", async () => {
    const result = await runCli(["test/fixtures/does-not-exist.md"])

    expect(result.code).toBe(2)
    expect(result.stderr).toContain("does-not-exist.md")
  })
})
