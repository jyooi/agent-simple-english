import { resolve } from "node:path"
import type { Effect } from "effect"
import type { SteConfig } from "../config/schema.ts"
import { type DictionaryLoadError, loadApprovedWordList, loadDictionary } from "./load.ts"
import type { DictionaryData } from "./schema.ts"

export const loadConfiguredDictionary = (
  config: SteConfig,
  cwd: string,
  replacementPath?: string,
): Effect.Effect<DictionaryData, DictionaryLoadError> => {
  if (config.approvedWordsPath !== undefined) {
    return loadApprovedWordList(resolve(cwd, config.approvedWordsPath))
  }
  return loadDictionary(replacementPath)
}
