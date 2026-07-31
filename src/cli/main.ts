#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { Effect } from "effect"
import { lint } from "../engine/lint.ts"
import type { LintReport } from "../engine/types.ts"

interface FileViolation {
  readonly file: string
  readonly ruleId: string
  readonly severity: string
  readonly message: string
  readonly line: number
  readonly column: number
}

interface CliReport {
  readonly violations: readonly FileViolation[]
  readonly summary: { readonly total: number; readonly hard: number }
}

const readStdin = Effect.promise(async () => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
})

const readInput = (path: string) =>
  path === "-"
    ? readStdin.pipe(Effect.map((text) => ({ path: "<stdin>", text })))
    : Effect.tryPromise({
        try: () => readFile(path, "utf8"),
        catch: (cause) => new Error(`cannot read ${path}: ${cause}`),
      }).pipe(Effect.map((text) => ({ path, text })))

const toCliReport = (reports: readonly { path: string; report: LintReport }[]): CliReport => {
  const violations = reports.flatMap(({ path, report }) =>
    report.violations.map((violation) => ({ file: path, ...violation })),
  )
  return {
    violations,
    summary: {
      total: violations.length,
      hard: violations.filter((violation) => violation.severity === "hard").length,
    },
  }
}

const render = (report: CliReport, json: boolean): string => {
  if (json) {
    return JSON.stringify(report, null, 2)
  }
  return report.violations
    .map((v) => `${v.file}:${v.line}:${v.column} ${v.ruleId} ${v.message}`)
    .join("\n")
}

const program = Effect.gen(function* () {
  const args = process.argv.slice(2)
  const json = args.includes("--json")
  const paths = args.filter((arg) => arg !== "--json")
  const inputs =
    paths.length === 0
      ? [{ path: "<stdin>", text: yield* readStdin }]
      : yield* Effect.forEach(paths, readInput)

  const report = toCliReport(
    inputs.map(({ path, text }) => ({ path, report: lint("prose-file", text) })),
  )

  const output = render(report, json)
  if (output !== "") {
    console.log(output)
  }
  return report.summary.hard > 0 ? 1 : 0
})

const exitCode = await Effect.runPromise(program).catch((error) => {
  console.error(String(error))
  return 2
})
process.exit(exitCode)
