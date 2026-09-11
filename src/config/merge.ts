import type { SteConfig } from "./schema.ts"

const mergeKey = <Key extends "rules" | "ruleDataExtensions">(
  key: Key,
  global: SteConfig,
  project: SteConfig,
): Partial<Pick<SteConfig, Key>> => {
  const base = global[key]
  const over = project[key]
  if (base === undefined && over === undefined) return {}
  return { [key]: { ...base, ...over } } as Partial<Pick<SteConfig, Key>>
}

export const mergeConfigs = (global: SteConfig, project: SteConfig): SteConfig => ({
  ...global,
  ...project,
  ...mergeKey("rules", global, project),
  ...mergeKey("ruleDataExtensions", global, project),
})
