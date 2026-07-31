#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { Effect, Either } from "effect"
import { loadConfig } from "../config/load.ts"
import { loadDictionary } from "../dictionary/load.ts"
import { lint } from "../engine/lint.ts"
import type { LintKind, LintReport, SourceDialect } from "../engine/types.ts"
import { TaggerService, WinkTaggerLive } from "../tagger/wink.ts"

const KINDS: readonly LintKind[] = ["prose-file", "slash-source", "hash-source", "commit-message"]

const SLASH_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "cs",
  "swift",
  "kt",
  "scala",
])

const HASH_EXTENSIONS = new Set(["sh", "bash", "zsh", "py", "rb", "yaml", "yml", "toml", "pl"])

interface PathClassification {
  readonly kind: LintKind
  readonly sourceDialect: SourceDialect
}

const classifyPath = (path: string): PathClassification => {
  const dot = path.lastIndexOf(".")
  if (dot <= path.lastIndexOf("/")) return { kind: "prose-file", sourceDialect: "general" }
  const extension = path.slice(dot + 1).toLowerCase()
  if (SLASH_EXTENSIONS.has(extension)) return { kind: "slash-source", sourceDialect: "general" }
  if (HASH_EXTENSIONS.has(extension)) {
    const sourceDialect = ["sh", "bash", "zsh"].includes(extension) ? "shell" : "general"
    return { kind: "hash-source", sourceDialect }
  }
  return { kind: "prose-file", sourceDialect: "general" }
}

interface CliArgs {
  readonly json: boolean
  readonly configPath: string | undefined
  readonly kind: string | undefined
  readonly kindMissingValue: boolean
  readonly paths: readonly string[]
}

const parseArgs = (args: readonly string[]): Effect.Effect<CliArgs, Error> =>
  Effect.gen(function* () {
    let json = false
    let configPath: string | undefined
    let kind: string | undefined
    let kindMissingValue = false
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
      } else {
        paths.push(arg)
      }
    }
    return { json, configPath, kind, kindMissingValue, paths }
  })

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

const program = Effect.gen(function* () {
  const tagger = yield* TaggerService
  const { json, configPath, kind, kindMissingValue, paths } = yield* parseArgs(
    process.argv.slice(2),
  )
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
