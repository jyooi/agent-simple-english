#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { Effect, Result } from "effect"
import packageManifest from "../../package.json" with { type: "json" }
import { splitViolations } from "../adapter/feedback.ts"
import { loadConfig } from "../config/load.ts"
import { loadConfiguredDictionary } from "../dictionary/configured.ts"
import { loadRuleData } from "../dictionary/load.ts"
import { classifyPath, type PathClassification } from "../engine/kinds.ts"
import { lint } from "../engine/lint.ts"
import type { LintKind, LintReport } from "../engine/types.ts"
import { makeLazyWinkTagger } from "../tagger/wink.ts"
import { hookInternalFailure, runHookMode } from "./hook.ts"
import { observationStats, reviewObservations } from "./observation-log.ts"
import { runSessionCommand } from "./session-command.ts"
import { tryAsync } from "./try-async.ts"

const KINDS: readonly LintKind[] = [
  "prose-file",
  "slash-source",
  "hash-source",
  "html",
  "commit-message",
]

const USAGE = `Usage: simple-english [options] [paths...]
       simple-english observe review
       simple-english observe stats

Options:
  --json           Write a JSON report.
  --config <path>  Use one config file.
  --kind <kind>    Use one content kind.
  --help           Print this help.
  --version        Print the package version.`

const CLI_OPTIONS = {
  json: { type: "boolean" },
  config: { type: "string" },
  kind: { type: "string" },
  help: { type: "boolean" },
  version: { type: "boolean" },
} as const

type CliArgs = ReturnType<typeof parseCliArgs>["values"]

const parseCliArgs = (args: readonly string[]) =>
  parseArgs({ args: [...args], options: CLI_OPTIONS, allowPositionals: true, strict: true })

const argumentError = (cause: unknown): Error => {
  const error = cause as { code?: string; message: string }
  const flag = /'(-{1,2}[\w-]+)/u.exec(error.message)?.[1]
  if (error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") return new Error(`unknown flag "${flag}"`)
  if (error.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" && flag === "--config") {
    return new Error("--config requires a file path")
  }
  if (error.code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" && flag === "--kind") {
    return new Error(`--kind requires a value; expected one of: ${KINDS.join(", ")}`)
  }
  return new Error(error.message)
}

// parseArgs accepts "--kind --json" with "--json" as the value. Reject that.
const rejectOptionValue = (values: CliArgs): Effect.Effect<void, Error> => {
  if (values.config?.startsWith("--"))
    return Effect.fail(new Error("--config requires a file path"))
  if (values.kind?.startsWith("--")) {
    return Effect.fail(new Error(`--kind requires a value; expected one of: ${KINDS.join(", ")}`))
  }
  return Effect.void
}

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
  readonly snippet: string
  readonly suggestions?: readonly string[]
  readonly line: number
  readonly column: number
}

interface CliReport {
  readonly violations: readonly FileViolation[]
  readonly summary: { readonly total: number; readonly hard: number }
  readonly skipped: readonly string[]
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
    : tryAsync(`cannot read ${path}`, () => readFile(path, "utf8")).pipe(
        Effect.map((text) => ({ path, text })),
      )

const toCliReport = (
  reports: readonly { path: string; report: LintReport }[],
  skipped: readonly string[],
): CliReport => {
  const violations = reports.flatMap(({ path, report }) =>
    report.violations.map((violation) => ({ file: path, ...violation })),
  )
  return {
    violations,
    summary: {
      total: violations.length,
      hard: splitViolations(violations).hard.length,
    },
    skipped,
  }
}

const render = (report: CliReport, json: boolean): string => {
  if (json) {
    return JSON.stringify(report, null, 2)
  }
  const lines = [
    ...report.skipped.map((path) => `${path}: skipped (non-prose extension)`),
    ...report.violations.map(
      (v) => `${v.file}:${v.line}:${v.column} [${v.severity}] ${v.ruleId} ${v.message}`,
    ),
  ]
  return lines.join("\n")
}

const args = process.argv.slice(2)
const tagger = makeLazyWinkTagger()

const hookProgram = Effect.gen(function* () {
  const output = yield* runHookMode(yield* readStdin, tagger)
  console.log(JSON.stringify(output))
  return 0
}).pipe(
  Effect.catchCause((cause) =>
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

const observeProgram = Effect.gen(function* () {
  const command = args[1]
  if (args.length !== 2 || (command !== "review" && command !== "stats")) {
    return yield* Effect.fail(new Error("Usage: simple-english observe <review|stats>"))
  }
  if (command === "review") {
    yield* tryAsync("cannot review observations", reviewObservations)
  } else {
    console.log(yield* tryAsync("cannot read observation stats", observationStats))
  }
  return 0
})

const lintProgram = Effect.gen(function* () {
  const { values, positionals: paths } = yield* Effect.try({
    try: () => parseCliArgs(args),
    catch: argumentError,
  })
  yield* rejectOptionValue(values)
  const { json = false, config: configPath, kind, help, version } = values
  if (help) {
    console.log(USAGE)
    return 0
  }
  if (version) {
    console.log(packageManifest.version)
    return 0
  }
  if (kind !== undefined && !isLintKind(kind)) {
    return yield* Effect.fail(
      new Error(`unknown kind "${kind}"; expected one of: ${KINDS.join(", ")}`),
    )
  }
  const config = yield* loadConfig(configPath)
  const loadedDictionary = yield* Effect.result(
    loadConfiguredDictionary(config, process.cwd(), process.env.SIMPLE_ENGLISH_DICTIONARY),
  )
  const loadedRuleData = yield* Effect.result(loadRuleData(config.ruleDataExtensions))
  if (Result.isFailure(loadedDictionary) && config.approvedWordsPath !== undefined) {
    return yield* Effect.fail(loadedDictionary.failure)
  }
  const dictionary = Result.getOrUndefined(loadedDictionary)
  const ruleData = Result.getOrUndefined(loadedRuleData)
  if (Result.isFailure(loadedDictionary)) {
    yield* Effect.sync(() => console.error(loadedDictionary.failure.message))
  }
  if (Result.isFailure(loadedRuleData)) {
    yield* Effect.sync(() => console.error(loadedRuleData.failure.message))
  }
  const inputs =
    paths.length === 0
      ? [{ path: "<stdin>", text: yield* readStdin }]
      : yield* Effect.forEach(paths, readInput)

  const skippedPaths: string[] = []
  const lintable: { path: string; text: string; classification: PathClassification }[] = []
  for (const input of inputs) {
    const classification = classifyPath(input.path)
    if (kind === undefined && classification.skipped) {
      skippedPaths.push(input.path)
      continue
    }
    lintable.push({ ...input, classification })
  }

  const report = toCliReport(
    lintable.map(({ path, text, classification }) => ({
      path,
      report: lint(kind ?? classification.kind, text, {
        ...config,
        dictionary,
        ruleData,
        tagger,
        sourceDialect: classification.sourceDialect,
      }),
    })),
    skippedPaths,
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
      : args[0] === "observe"
        ? observeProgram
        : lintProgram

const handled = program.pipe(
  Effect.catch((error) =>
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
