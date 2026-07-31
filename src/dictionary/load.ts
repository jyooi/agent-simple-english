import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Effect, ParseResult, Schema } from "effect"
import { type Dictionary, DictionarySchema } from "./schema.ts"

export const BUNDLED_DICTIONARY_PATH = fileURLToPath(new URL("./data/pi-ste.json", import.meta.url))

export class DictionaryLoadError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`Cannot load STE dictionary from ${path}: ${reason}`)
    this.name = "DictionaryLoadError"
  }
}

const formatParseError = (error: ParseResult.ParseError): string => {
  const issue = ParseResult.ArrayFormatter.formatErrorSync(error)[0]
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

export const loadDictionary = (
  path = BUNDLED_DICTIONARY_PATH,
): Effect.Effect<Dictionary, DictionaryLoadError> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new DictionaryLoadError(
        path,
        `cannot read file: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
  }).pipe(
    Effect.flatMap(Schema.decode(Schema.parseJson(DictionarySchema))),
    Effect.mapError((cause) =>
      cause instanceof DictionaryLoadError
        ? cause
        : new DictionaryLoadError(path, formatParseError(cause)),
    ),
  )
