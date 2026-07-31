#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { Effect, Either } from "effect"
import { loadConfig } from "../config/load.ts"
import { loadDictionary } from "../dictionary/load.ts"
import { lint } from "../engine/lint.ts"
import type { LintReport } from "../engine/types.ts"
import { TaggerService, WinkTaggerLive } from "../tagger/wink.ts"

interface CliArgs {
  readonly json: boolean
  readonly configPath: string | undefined
  readonly paths: readonly string[]
}

const parseArgs = (args: readonly string[]): Effect.Effect<CliArgs, Error> =>
  Effect.gen(function* () {
    let json = false
    let configPath: string | undefined
    const paths: string[] = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] as string
      if (arg === "--json") {
        json = true
      } else if (arg === "--config") {
        configPath = args[++i]
        if (configPath === undefined) {
          yield* Effect.fail(new Error("--config requires a file path"))
        }
      } else {
        paths.push(arg)
      }
    }
    return { json, configPath, paths }
  })

interface FileViolation {
  readonly file: string
  readonly ruleId: string
  readonly severity: string
  readonly message: string
  readonly suggestions?: readonly string[]
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
  const tagger = yield* TaggerService
  const { json, configPath, paths } = yield* parseArgs(process.argv.slice(2))
  const config = yield* loadConfig(configPath)
  const loadedDictionary = yield* Effect.either(
    loadDictionary(process.env.SIMPLE_ENGLISH_DICTIONARY),
  )
  const dictionary = Either.getOrUndefined(loadedDictionary)
  if (Either.isLeft(loadedDictionary)) {
    yield* Effect.sync(() => console.error(loadedDictionary.left.message))
  }
  const inputs =
    paths.length === 0
      ? [{ path: "<stdin>", text: yield* readStdin }]
      : yield* Effect.forEach(paths, readInput)

  const report = toCliReport(
    inputs.map(({ path, text }) => ({
      path,
      report: lint("prose-file", text, { ...config, dictionary, tagger }),
    })),
  )

  const output = render(report, json)
  if (output !== "") {
    console.log(output)
  }
  return report.summary.hard > 0 ? 1 : 0
})

const handled = program.pipe(
  Effect.provide(WinkTaggerLive),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      console.error(error.message)
      return 2
    }),
  ),
)

const exitCode = await Effect.runPromise(handled).catch((error) => {
  console.error(String(error))
  return 2
})
process.exit(exitCode)
