import type { LintKind, SourceDialect } from "./types.ts"

export interface PathClassification {
  readonly kind: LintKind
  readonly sourceDialect: SourceDialect
  readonly skipped?: true
}

const PROSE: PathClassification = { kind: "prose-file", sourceDialect: "general" }
// Data and style files carry rules and structured data rather than prose,
// so the writing rules would misread them as sentences (HUF-308).
const SKIPPED: PathClassification = { ...PROSE, skipped: true }
const HTML: PathClassification = { kind: "html", sourceDialect: "general" }

const slash = (sourceDialect: SourceDialect): PathClassification => ({
  kind: "slash-source",
  sourceDialect,
})
const hash = (sourceDialect: SourceDialect): PathClassification => ({
  kind: "hash-source",
  sourceDialect,
})

const BY_EXTENSION: Readonly<Record<string, PathClassification>> = {
  ts: slash("javascript"),
  tsx: slash("javascript"),
  js: slash("javascript"),
  jsx: slash("javascript"),
  mjs: slash("javascript"),
  cjs: slash("javascript"),
  rs: slash("nested-slash"),
  swift: slash("nested-slash"),
  kt: slash("nested-slash"),
  scala: slash("nested-slash"),
  go: slash("general"),
  java: slash("general"),
  c: slash("general"),
  h: slash("general"),
  cpp: slash("general"),
  hpp: slash("general"),
  cc: slash("general"),
  cs: slash("general"),
  sh: hash("shell"),
  bash: hash("shell"),
  zsh: hash("shell"),
  yaml: hash("yaml"),
  yml: hash("yaml"),
  rb: hash("ruby"),
  pl: hash("perl"),
  py: hash("general"),
  toml: hash("general"),
  html: HTML,
  htm: HTML,
  css: SKIPPED,
  scss: SKIPPED,
  less: SKIPPED,
  json: SKIPPED,
  jsonc: SKIPPED,
  svg: SKIPPED,
  xml: SKIPPED,
  typ: SKIPPED,
  csv: SKIPPED,
  tsv: SKIPPED,
  lock: SKIPPED,
}

export const classifyPath = (path: string): PathClassification => {
  const dot = path.lastIndexOf(".")
  if (dot <= Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))) return PROSE
  return BY_EXTENSION[path.slice(dot + 1).toLowerCase()] ?? PROSE
}
