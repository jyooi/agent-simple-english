import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Schema } from "effect"
import { formatParseErrorIssues, type ParseError } from "../schema/parse-error.ts"
import { BUNDLED_RULE_DATA } from "./bundled-rule-data.ts"
import type { RuleData, RuleDataExtensions, RuleDataId } from "./rule-data.ts"
import {
  type ApprovedWordList,
  ApprovedWordListSchema,
  type Dictionary,
  DictionarySchema,
} from "./schema.ts"

export const BUNDLED_DICTIONARY_PATH = fileURLToPath(new URL("./data/pi-ste.json", import.meta.url))

type DictionaryLoadLabel = "STE dictionary" | "rule data"

export class DictionaryLoadError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
    label: DictionaryLoadLabel = "STE dictionary",
  ) {
    super(`Cannot load ${label} from ${path}: ${reason}`)
    this.name = "DictionaryLoadError"
  }
}

const formatParseError = (error: ParseError): string => {
  const issue = formatParseErrorIssues(error)[0]
  if (issue === undefined) {
    return "invalid dictionary data"
  }
  const path = issue.path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`
    }
    return result === "" ? String(segment) : `${result}.${String(segment)}`
  }, "")
  return path === "" ? `invalid dictionary data: ${issue.message}` : `${path}: ${issue.message}`
}

// v4 omits the rejected value from an issue unless reportInput is on.
const decodeOptions = { onExcessProperty: "error", errors: "all", reportInput: true } as const

const decodeDictionary = Schema.decodeEffect(Schema.fromJsonString(DictionarySchema), decodeOptions)

const decodeApprovedWordList = Schema.decodeEffect(
  Schema.fromJsonString(ApprovedWordListSchema),
  decodeOptions,
)

const readDictionaryFile = (
  path: string,
  label: DictionaryLoadLabel,
): Effect.Effect<string, DictionaryLoadError> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new DictionaryLoadError(
        path,
        `cannot read file: ${cause instanceof Error ? cause.message : String(cause)}`,
        label,
      ),
  })

const loadDictionaryData = (
  path: string,
  label: DictionaryLoadLabel,
): Effect.Effect<Dictionary, DictionaryLoadError> =>
  readDictionaryFile(path, label).pipe(
    Effect.flatMap(decodeDictionary),
    Effect.mapError((cause) =>
      cause instanceof DictionaryLoadError
        ? cause
        : new DictionaryLoadError(path, formatParseError(cause), label),
    ),
  )

export const loadDictionary = (
  path = BUNDLED_DICTIONARY_PATH,
): Effect.Effect<Dictionary, DictionaryLoadError> => loadDictionaryData(path, "STE dictionary")

export const loadApprovedWordList = (
  path: string,
): Effect.Effect<ApprovedWordList, DictionaryLoadError> =>
  readDictionaryFile(path, "STE dictionary").pipe(
    Effect.flatMap(decodeApprovedWordList),
    Effect.mapError((cause) =>
      cause instanceof DictionaryLoadError
        ? cause
        : new DictionaryLoadError(path, formatParseError(cause)),
    ),
  )

const loadExtendedRuleData = (
  id: RuleDataId,
  extensionPaths: readonly string[],
  cwd: string,
): Effect.Effect<Dictionary, DictionaryLoadError> => {
  const bundled = BUNDLED_RULE_DATA[id]
  return Effect.all(
    extensionPaths.map((path) => loadDictionaryData(resolve(cwd, path), "rule data")),
  ).pipe(
    Effect.map((extensions) => ({
      ...bundled,
      entries: [bundled, ...extensions].flatMap((dictionary) => dictionary.entries),
    })),
  )
}

export const loadRuleData = (
  extensions: RuleDataExtensions = {},
  cwd = process.cwd(),
): Effect.Effect<RuleData, DictionaryLoadError> =>
  Effect.all({
    "phrasal-verb": loadExtendedRuleData("phrasal-verb", extensions["phrasal-verb"] ?? [], cwd),
    hedging: loadExtendedRuleData("hedging", extensions.hedging ?? [], cwd),
    marketing: loadExtendedRuleData("marketing", extensions.marketing ?? [], cwd),
    "adjectival-participle": loadExtendedRuleData(
      "adjectival-participle",
      extensions["adjectival-participle"] ?? [],
      cwd,
    ),
  })
