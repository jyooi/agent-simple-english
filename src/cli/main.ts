#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { Effect, Either } from "effect"
import packageManifest from "../../package.json" with { type: "json" }
import { loadConfig } from "../config/load.ts"
import { loadDictionary } from "../dictionary/load.ts"
import { classifyPath } from "../engine/kinds.ts"
import { lint } from "../engine/lint.ts"
import type { LintKind, LintReport } from "../engine/types.ts"
import { TaggerService, WinkTaggerLive } from "../tagger/wink.ts"
import { hookInternalFailure, runHookMode } from "./hook.ts"
import { runSessionCommand } from "./session-command.ts"

const KINDS: readonly LintKind[] = ["prose-file", "slash-source", "hash-source", "commit-message"]

const USAGE = `Usage: simple-english [options] [paths...]

Options:
  --json           Write a JSON report.
  --config <path>  Use one config file.
  --kind <kind>    Use one content kind.
  --help           Print this help.
  --version        Print the package version.`

interface CliArgs {
  readonly json: boolean
  readonly configPath: string | undefined
  readonly kind: string | undefined
  readonly kindMissingValue: boolean
  readonly help: boolean
  readonly version: boolean
  readonly paths: readonly string[]
}

const parseArgs = (args: readonly string[]): Effect.Effect<CliArgs, Error> =>
  Effect.gen(function* () {
    let json = false
    let configPath: string | undefined
    let kind: string | undefined
    let kindMissingValue = false
    let help = false
    let version = false
    const paths: string[] = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] as string
      if (arg === "--json") {
        json = true
      } else if (arg === "--config") {
        const value = args[i + 1]
        if (value === undefined || value.startsWith("--")) {
          yield* Effect.fail(new Error("--config requires a file path"))
        }
        configPath = value
        i++
      } else if (arg === "--kind") {
        const value = args[i + 1]
        if (value === undefined || value.startsWith("--")) {
          kindMissingValue = true
        } else {
          kind = value
          i++
        }
      } else if (arg.startsWith("--kind=")) {
        kind = arg.slice("--kind=".length)
      } else if (arg === "--help") {
        help = true
      } else if (arg === "--version") {
        version = true
      } else if (arg.startsWith("--")) {
        yield* Effect.fail(new Error(`unknown flag "${arg}"`))
      } else {
        paths.push(arg)
      }
    }
    return { json, configPath, kind, kindMissingValue, help, version, paths }
  })

const rejectUnknownFlags = (args: readonly string[]): Effect.Effect<void, Error> => {
  const flag = args.find((arg) => arg.startsWith("--"))
  return flag === undefined ? Effect.void : Effect.fail(new Error(`unknown flag "${flag}"`))
}

const isLintKind = (value: string): value is LintKind =>
  (KINDS as readonly string[]).includes(value)

interface FileViolation {
  readonly file: string
  readonly ruleId: string
  readonly severity: string
  readonly message: string
  readonly suggestions?: readonly string[]
  readonly line: number
  readonly column: number
  readonly suggestion?: string
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
    .map((v) => `${v.file}:${v.line}:${v.column} [${v.severity}] ${v.ruleId} ${v.message}`)
    .join("\n")
}

const args = process.argv.slice(2)

const hookProgram = Effect.gen(function* () {
  const output = yield* runHookMode(yield* readStdin).pipe(Effect.provide(WinkTaggerLive))
  console.log(JSON.stringify(output))
  return 0
}).pipe(
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      console.log(JSON.stringify(hookInternalFailure(cause)))
      return 0
    }),
  ),
)

const sessionProgram = Effect.gen(function* () {
  console.log(yield* runSessionCommand(args.slice(1)))
  return 0
})

const lintProgram = Effect.gen(function* () {
  const tagger = yield* TaggerService
  const { json, configPath, kind, kindMissingValue, help, version, paths } = yield* parseArgs(args)
  if (help) {
    console.log(USAGE)
    return 0
  }
  if (version) {
    console.log(packageManifest.version)
    return 0
  }
  if (kindMissingValue) {
    return yield* Effect.fail(
      new Error(`--kind requires a value; expected one of: ${KINDS.join(", ")}`),
    )
  }
  if (kind !== undefined && !isLintKind(kind)) {
    return yield* Effect.fail(
      new Error(`unknown kind "${kind}"; expected one of: ${KINDS.join(", ")}`),
    )
  }
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
    inputs.map(({ path, text }) => {
      const classification = classifyPath(path)
      return {
        path,
        report: lint(kind ?? classification.kind, text, {
          ...config,
          dictionary,
          tagger,
          sourceDialect: classification.sourceDialect,
        }),
      }
    }),
  )

  const output = render(report, json)
  if (output !== "") {
    console.log(output)
  }
  return report.summary.hard > 0 ? 1 : 0
})

const program: Effect.Effect<number, Error> =
  args[0] === "hook"
    ? rejectUnknownFlags(args.slice(1)).pipe(Effect.andThen(hookProgram))
    : args[0] === "session"
      ? rejectUnknownFlags(args.slice(1)).pipe(Effect.andThen(sessionProgram))
      : lintProgram.pipe(Effect.provide(WinkTaggerLive))

const handled = program.pipe(
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
