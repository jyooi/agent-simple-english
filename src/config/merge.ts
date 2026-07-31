import type { SteConfig } from "./schema.ts"

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const deepMerge = (
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> => {
  const merged = { ...base }
  for (const [key, value] of Object.entries(over)) {
    const existing = merged[key]
    merged[key] =
      isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value
  }
  return merged
}

export const mergeConfigs = (global: SteConfig, project: SteConfig): SteConfig =>
  deepMerge(global as Record<string, unknown>, project as Record<string, unknown>) as SteConfig
