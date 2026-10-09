import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { expect, test } from "vitest"

const repositoryRoot = join(import.meta.dirname, "..")

const isTestData = (path: string): boolean => path.startsWith("test/fixtures/")

const checkedFiles = (): string[] =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src", "test"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((path) => path.endsWith(".ts") && !isTestData(path))

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

test("the TypeScript scanner does not read a shebang line or string content as a comment", () => {
  expect(
    commentsIn("example.ts", '#!/usr/bin/env bun\nconst url = "https://example.test"\n'),
  ).toEqual([])
})

test("the scanner finds line comments, block comments, and JSDoc blocks", () => {
  const text = [
    "#!/usr/bin/env bun",
    "/** a */",
    "const a = 1 // b",
    "const b = [/* c */ a]",
    "// d",
  ].join("\n")
  expect(commentsIn("example.ts", text)).toEqual([
    "example.ts:2",
    "example.ts:3",
    "example.ts:4",
    "example.ts:5",
  ])
})

test("no TypeScript file under src or test holds a comment, except the test data under test/fixtures", () => {
  const comments = checkedFiles().flatMap((path) =>
    commentsIn(path, readFileSync(join(repositoryRoot, path), "utf8")),
  )
  expect(comments, `Remove each comment:\n${comments.join("\n")}`).toEqual([])
})
