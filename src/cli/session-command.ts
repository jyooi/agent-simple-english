import { resolve } from "node:path"
import { Effect, Either } from "effect"
import { formatFailedStatusSummary, formatStatusSummary } from "../adapter/rule-summary.ts"
import { loadConfig } from "../config/load.ts"
import { loadConfiguredDictionary } from "../dictionary/configured.ts"
import { loadRuleData } from "../dictionary/load.ts"
import {
  type SessionControl,
  getSessionControl,
  setSessionEnabled,
  setSessionStrict,
  toggleSessionEnabled,
} from "./session-state.ts"

const USAGE = "Usage: /ase [on|off|status|strict|strict off]"

type DictionaryState = "loaded" | "not loaded" | `failed (${string})`

function modeName(control: SessionControl): "disabled" | "enabled" | "strict" {
  if (!control.enabled) return "disabled"
  return control.strict ? "strict" : "enabled"
}

const readControl = (sessionId: string) =>
  Effect.tryPromise({
    try: () => getSessionControl(sessionId),
    catch: (cause) => new Error(`cannot read session state: ${cause}`),
  })

const updateEnabled = (sessionId: string, enabled: boolean) =>
  Effect.tryPromise({
    try: () => setSessionEnabled(sessionId, enabled),
    catch: (cause) => new Error(`cannot update session state: ${cause}`),
  })

const toggleEnabled = (sessionId: string) =>
  Effect.tryPromise({
    try: () => toggleSessionEnabled(sessionId),
    catch: (cause) => new Error(`cannot update session state: ${cause}`),
  })

const updateStrict = (sessionId: string, strict: boolean) =>
  Effect.tryPromise({
    try: () => setSessionStrict(sessionId, strict),
    catch: (cause) => new Error(`cannot update session state: ${cause}`),
  })

function status(sessionId: string, cwd: string): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const control = yield* readControl(sessionId)
    const configResult = yield* Effect.either(loadConfig(undefined, cwd))
    if (Either.isLeft(configResult)) {
      return formatFailedStatusSummary(modeName(control), configResult.left.message)
    }
    const dictionaryPath = process.env.SIMPLE_ENGLISH_DICTIONARY
    const dictionaryResult = yield* Effect.either(
      Effect.all({
        dictionary: loadConfiguredDictionary(
          configResult.right,
          cwd,
          dictionaryPath === undefined ? undefined : resolve(cwd, dictionaryPath),
        ),
        ruleData: loadRuleData(configResult.right.ruleDataExtensions, cwd),
      }),
    )
    const dictionary: DictionaryState = Either.isRight(dictionaryResult)
      ? "loaded"
      : `failed (${dictionaryResult.left.message})`
    return formatStatusSummary(configResult.right, modeName(control), dictionary)
  })
}

export function runSessionCommand(args: readonly string[]): Effect.Effect<string, Error> {
  const [sessionId, cwd, ...commandParts] = args
  if (sessionId === undefined || sessionId.length === 0 || cwd === undefined || cwd.length === 0) {
    return Effect.fail(new Error(USAGE))
  }
  const command = commandParts.join(" ").trim().toLowerCase()
  if (command === "") {
    return toggleEnabled(sessionId).pipe(
      Effect.map((enabled) => `Writing-rule enforcement ${enabled ? "enabled" : "disabled"}.`),
    )
  }
  if (command === "status") return status(sessionId, cwd)
  if (command === "on") {
    return updateEnabled(sessionId, true).pipe(Effect.as("Writing-rule enforcement enabled."))
  }
  if (command === "off") {
    return updateEnabled(sessionId, false).pipe(Effect.as("Writing-rule enforcement disabled."))
  }
  if (command === "strict" || command === "strict on") {
    return updateStrict(sessionId, true).pipe(Effect.as("Writing-rule strict mode enabled."))
  }
  if (command === "strict off") {
    return updateStrict(sessionId, false).pipe(Effect.as("Writing-rule strict mode disabled."))
  }
  return Effect.fail(new Error(USAGE))
}
