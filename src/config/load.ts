import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { mergeConfigs } from "./merge.ts"
import { ConfigError, type SteConfig, decodeConfig } from "./schema.ts"

export const globalConfigPath = (): string => join(homedir(), ".pi", "agent", "simple-english.json")

export const projectConfigPath = (cwd: string): string => join(cwd, ".pi", "simple-english.json")

const isMissingFile = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && (cause as { code?: string }).code === "ENOENT"

const readConfigFile = (path: string, optional: boolean): Effect.Effect<SteConfig, ConfigError> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => cause,
  }).pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        optional && isMissingFile(cause)
          ? Effect.succeed<SteConfig>({})
          : Effect.fail(new ConfigError(`cannot read config file ${path}: ${cause}`)),
      onSuccess: (text) =>
        Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: (cause) => new ConfigError(`invalid JSON in ${path}: ${cause}`),
        }).pipe(Effect.flatMap((json) => decodeConfig(json, path))),
    }),
  )

export const loadConfig = (
  explicitPath?: string,
  cwd = process.cwd(),
): Effect.Effect<SteConfig, ConfigError> =>
  explicitPath === undefined
    ? Effect.all([
        readConfigFile(globalConfigPath(), true),
        readConfigFile(projectConfigPath(cwd), true),
      ]).pipe(Effect.map(([global, project]) => mergeConfigs(global, project)))
    : readConfigFile(explicitPath, false)
