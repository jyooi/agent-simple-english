import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"

const repositoryRoot = join(import.meta.dirname, "..")

const isTestData = (path: string): boolean => path.startsWith("test/fixtures/")

const checkedFiles = (): string[] =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(
      (path) => path.endsWith(".ts") && !isTestData(path) && existsSync(join(repositoryRoot, path)),
    )

const commentsIn = (path: string, text: string): string[] => {
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const startOffsets = new Set<number>()
  const visit = (node: ts.Node): void => {
    const triviaStart = node.getFullStart()
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, triviaStart) ?? []),
      ...(ts.getTrailingCommentRanges(text, triviaStart) ?? []),
    ]) {
      startOffsets.add(range.pos)
    }
    for (const child of node.getChildren(sourceFile)) visit(child)
  }
  visit(sourceFile)
  return [...startOffsets]
    .sort((left, right) => left - right)
    .map((offset) => `${path}:${sourceFile.getLineAndCharacterOfPosition(offset).line + 1}`)
}

const comments = checkedFiles().flatMap((path) =>
  commentsIn(path, readFileSync(join(repositoryRoot, path), "utf8")),
)

if (comments.length > 0) {
  console.error(`Remove each comment:\n${comments.join("\n")}`)
  process.exit(1)
}
