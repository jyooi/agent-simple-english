import type { LintKind, SourceDialect } from "./types.ts"

const SLASH_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "cs",
  "swift",
  "kt",
  "scala",
])

const HASH_EXTENSIONS = new Set(["sh", "bash", "zsh", "py", "rb", "yaml", "yml", "toml", "pl"])

export interface PathClassification {
  readonly kind: LintKind
  readonly sourceDialect: SourceDialect
}

export const classifyPath = (path: string): PathClassification => {
  const dot = path.lastIndexOf(".")
  if (dot <= Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))) {
    return { kind: "prose-file", sourceDialect: "general" }
  }
  const extension = path.slice(dot + 1).toLowerCase()
  if (SLASH_EXTENSIONS.has(extension)) return { kind: "slash-source", sourceDialect: "general" }
  if (HASH_EXTENSIONS.has(extension)) {
    const sourceDialect = ["sh", "bash", "zsh"].includes(extension)
      ? "shell"
      : ["yaml", "yml"].includes(extension)
        ? "yaml"
        : "general"
    return { kind: "hash-source", sourceDialect }
  }
  return { kind: "prose-file", sourceDialect: "general" }
}
