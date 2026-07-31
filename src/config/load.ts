import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { Effect } from "effect"
import { mergeConfigs } from "./merge.ts"
import { ConfigError, type SteConfig, decodeConfig } from "./schema.ts"

const legacyAgentConfigDirectory = (): string => {
  const configured = process.env.PI_CODING_AGENT_DIR
  if (!configured) return join(homedir(), ".pi", "agent")
  if (configured === "~") return homedir()
  return configured.startsWith("~/") ||
    (process.platform === "win32" && configured.startsWith("~\\"))
    ? join(homedir(), configured.slice(2))
    : configured
}

const xdgConfigDirectory = (): string => {
  const configured = process.env.XDG_CONFIG_HOME
  return configured && isAbsolute(configured) ? configured : join(homedir(), ".config")
}

export const globalConfigPath = (): string =>
  join(xdgConfigDirectory(), "simple-english", "config.json")

export const projectConfigPath = (cwd: string): string => join(cwd, ".simple-english.json")

export const legacyGlobalConfigPath = (): string =>
  join(legacyAgentConfigDirectory(), "simple-english.json")

export const legacyProjectConfigPath = (cwd: string): string =>
  join(cwd, ".pi", "simple-english.json")

const isMissingFile = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && (cause as { code?: string }).code === "ENOENT"

const readConfigFile = (
  path: string,
  optional: boolean,
): Effect.Effect<SteConfig | undefined, ConfigError> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) => cause,
  }).pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        optional && isMissingFile(cause)
          ? Effect.succeed(undefined)
          : Effect.fail(new ConfigError(`cannot read config file ${path}: ${cause}`)),
      onSuccess: (text) =>
        Effect.try({
          try: () => JSON.parse(text) as unknown,
          catch: (cause) => new ConfigError(`invalid JSON in ${path}: ${cause}`),
        }).pipe(Effect.flatMap((json) => decodeConfig(json, path))),
    }),
  )

const readConfigWithFallback = (
  path: string,
  fallbackPath: string,
): Effect.Effect<SteConfig, ConfigError> =>
  readConfigFile(path, true).pipe(
    Effect.flatMap((config) =>
      config === undefined
        ? readConfigFile(fallbackPath, true).pipe(Effect.map((fallback) => fallback ?? {}))
        : Effect.succeed(config),
    ),
  )

export const loadConfig = (
  explicitPath?: string,
  cwd = process.cwd(),
  includeProjectConfig = true,
): Effect.Effect<SteConfig, ConfigError> => {
  if (explicitPath !== undefined) {
    return readConfigFile(explicitPath, false).pipe(Effect.map((config) => config ?? {}))
  }
  const globalConfig = readConfigWithFallback(globalConfigPath(), legacyGlobalConfigPath())
  if (!includeProjectConfig) return globalConfig
  const projectConfig = readConfigWithFallback(projectConfigPath(cwd), legacyProjectConfigPath(cwd))
  return Effect.all([globalConfig, projectConfig]).pipe(
    Effect.map(([global, project]) => mergeConfigs(global, project)),
  )
}
