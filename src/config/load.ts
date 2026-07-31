import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { mergeConfigs } from "./merge.ts"
import { ConfigError, type SteConfig, decodeConfig } from "./schema.ts"

const agentConfigDirectory = (): string => {
  const configured = process.env.PI_CODING_AGENT_DIR
  if (!configured) {
    return join(homedir(), ".pi", "agent")
  }
  if (configured === "~") {
    return homedir()
  }
  return configured.startsWith("~/") ||
    (process.platform === "win32" && configured.startsWith("~\\"))
    ? join(homedir(), configured.slice(2))
    : configured
}

export const globalConfigPath = (): string => join(agentConfigDirectory(), "simple-english.json")

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
  includeProjectConfig = true,
): Effect.Effect<SteConfig, ConfigError> => {
  if (explicitPath !== undefined) return readConfigFile(explicitPath, false)
  const globalConfig = readConfigFile(globalConfigPath(), true)
  if (!includeProjectConfig) return globalConfig
  return Effect.all([globalConfig, readConfigFile(projectConfigPath(cwd), true)]).pipe(
    Effect.map(([global, project]) => mergeConfigs(global, project)),
  )
}
