import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { checkChart } from "../../scripts/check-verification.ts"

const chartPath = ".claude/skills/verify-reply-hold/charts/feature-x.md"
const coveredFile = "hooks/reply-hold.ts"
const coveredSha = "f49ee8269d9f774ee95181efccf65ec1a6201c8dffc6b55d44903e37538625d2"
const specPath = ".claude/skills/verify-reply-hold/ReplyHold.tla"
const configPath = ".claude/skills/verify-reply-hold/ReplyHold.cfg"
const digest = "e3243dc2b06fc43c2f3a5491cb06c64af94609b8312301681e08d1708f773b83"
const changedModelDigest = "c4c107aacab86b475a43359bd98e59794a6f20df6561eb316cfe0e1827c5f0d0"
const imagePath = ".claude/skills/verify-reply-hold/charts/feature-x.svg"
const chartDigest = "4a86c6636a2039878fcd01471deaf08b41ed06c016fd8b203c8fedd102989189"
const olderChartDigest = "3b0b858af0541122e291223190856bd5ef968e320f54a7afd4d49c8044c62e80"
const image = (named: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg"><desc>Chart digest: ${named}</desc></svg>\n`

const record = {
  tool: { version: "1.7.4", url: "", sha256: "" },
  model: { spec: "ReplyHold.tla", config: "ReplyHold.cfg" },
  covers: [{ file: coveredFile, sha256: coveredSha }],
  properties: [],
}

let root: string

const git = (...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
    ].concat(args),
    { cwd: root, encoding: "utf8" },
  )

const commit = (files: Record<string, string>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  git("add", "-A")
  git("commit", "-q", "-m", "change")
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "check-chart-"))
  git("init", "-q", "-b", "main")
  commit({
    [coveredFile]: "one\n",
    "README.md": "one\n",
    [specPath]: "---- MODULE ReplyHold ----\n====\n",
    [configPath]: "INVARIANTS\n  TypeOK\n",
  })
  git("update-ref", "refs/remotes/origin/main", "HEAD")
  git("checkout", "-q", "-b", "feature/x")
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

const mermaid = "## State chart\n\n```mermaid\nstateDiagram-v2\n  [*] --> a\n```\n"

describe("state chart file of a change", () => {
  test("is not checked when HEAD has no change from origin/main", async () => {
    git("checkout", "-q", "main")
    expect(await checkChart(root, record)).toEqual([])
  })

  test("fails when the change adds no chart file", async () => {
    commit({ "README.md": "two\n" })
    expect(await checkChart(root, record)).toEqual([
      expect.stringContaining("adds no state chart file"),
    ])
  })

  test("fails when the change only edits a chart file of an earlier change", async () => {
    git("checkout", "-q", "main")
    commit({ [chartPath]: "No state change: docs.\n" })
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("checkout", "-q", "-b", "feature/y")
    commit({ [chartPath]: "No state change: other docs.\n" })
    expect(await checkChart(root, record)).toEqual([
      expect.stringContaining("adds no state chart file"),
    ])
  })

  test("passes with a no state change note when no verified file changed", async () => {
    commit({ "README.md": "two\n", [chartPath]: "No state change: this PR changes only docs.\n" })
    expect(await checkChart(root, record)).toEqual([])
  })

  test("fails when the chart file has no mermaid chart and no note", async () => {
    commit({ [chartPath]: "## State chart\n\nTo do.\n" })
    expect(await checkChart(root, record)).toEqual([expect.stringContaining("no mermaid chart")])
  })

  test("fails when a covered file changed and the chart does not name the covered digest", async () => {
    commit({ [coveredFile]: "two\n", [chartPath]: mermaid, [imagePath]: image(chartDigest) })
    expect(await checkChart(root, record)).toEqual([expect.stringContaining(digest)])
  })

  test("fails when only the model changed and the chart names the covered digest before the change", async () => {
    commit({
      [specPath]: "---- MODULE ReplyHold ----\nVARIABLE x\n====\n",
      [chartPath]: `${mermaid}\nCovered digest: ${digest}\n`,
      [imagePath]: image(chartDigest),
    })
    expect(await checkChart(root, record)).toEqual([expect.stringContaining(changedModelDigest)])
  })

  test("passes when a covered file changed and the chart names the covered digest", async () => {
    commit({
      [coveredFile]: "two\n",
      [chartPath]: `${mermaid}\nCovered digest: ${digest}\n`,
      [imagePath]: image(chartDigest),
    })
    expect(await checkChart(root, record)).toEqual([])
  })

  test("fails when a chart file has a chart and the change has no SVG image", async () => {
    commit({ [chartPath]: mermaid })
    expect(await checkChart(root, record)).toEqual([expect.stringContaining("no SVG image")])
  })

  test("fails when the SVG image names the digest of an older chart text", async () => {
    commit({ [chartPath]: mermaid, [imagePath]: image(olderChartDigest) })
    expect(await checkChart(root, record)).toEqual([
      expect.stringContaining(`older than the chart text`),
    ])
  })

  test("passes when the SVG image names the digest of the chart text", async () => {
    commit({ [chartPath]: mermaid, [imagePath]: image(chartDigest) })
    expect(await checkChart(root, record)).toEqual([])
  })

  test("needs no SVG image for a no state change note", async () => {
    commit({ [chartPath]: "No state change: this PR changes only docs.\n" })
    expect(await checkChart(root, record)).toEqual([])
  })
})
