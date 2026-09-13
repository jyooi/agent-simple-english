import { resolve } from "node:path"
import { Effect, Result } from "effect"
import { formatFailedStatusSummary, formatStatusSummary } from "../adapter/rule-summary.ts"
import { loadConfig } from "../config/load.ts"
import { loadConfiguredDictionary } from "../dictionary/configured.ts"
import { loadRuleData } from "../dictionary/load.ts"
import {
  getSessionControl,
  type SessionControl,
  setSessionEnabled,
  setSessionStrict,
  toggleSessionEnabled,
} from "./session-state.ts"
import { tryAsync } from "./try-async.ts"

const USAGE = "Usage: /ase [on|off|status|strict|strict off]"

type DictionaryState = "loaded" | "not loaded" | `failed (${string})`

function modeName(control: SessionControl): "disabled" | "enabled" | "strict" {
  if (!control.enabled) return "disabled"
  return control.strict ? "strict" : "enabled"
}

const readControl = (sessionId: string) =>
  tryAsync("cannot read session state", () => getSessionControl(sessionId))

const updateEnabled = (sessionId: string, enabled: boolean) =>
  tryAsync("cannot update session state", () => setSessionEnabled(sessionId, enabled))

const toggleEnabled = (sessionId: string) =>
  tryAsync("cannot update session state", () => toggleSessionEnabled(sessionId))

const updateStrict = (sessionId: string, strict: boolean) =>
  tryAsync("cannot update session state", () => setSessionStrict(sessionId, strict))

function status(sessionId: string, cwd: string): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const control = yield* readControl(sessionId)
    const configResult = yield* Effect.result(loadConfig(undefined, cwd))
    if (Result.isFailure(configResult)) {
      return formatFailedStatusSummary(modeName(control), configResult.failure.message)
    }
    const dictionaryPath = process.env.SIMPLE_ENGLISH_DICTIONARY
    const dictionaryResult = yield* Effect.result(
      Effect.all({
        dictionary: loadConfiguredDictionary(
          configResult.success,
          cwd,
          dictionaryPath === undefined ? undefined : resolve(cwd, dictionaryPath),
        ),
        ruleData: loadRuleData(configResult.success.ruleDataExtensions, cwd),
      }),
    )
    const dictionary: DictionaryState = Result.isSuccess(dictionaryResult)
      ? "loaded"
      : `failed (${dictionaryResult.failure.message})`
    return formatStatusSummary(configResult.success, modeName(control), dictionary)
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
