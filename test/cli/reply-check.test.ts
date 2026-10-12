import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { runCli } from "./run-cli.ts"

interface Observation {
  readonly event: string
  readonly sessionId: string
  readonly cwd: string
  readonly kind: string
  readonly decision: string
  readonly findings: readonly { readonly ruleId: string; readonly severity: string }[]
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function makeDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(path)
  return path
}

async function observations(xdgStateHome: string): Promise<Observation[]> {
  const directory = join(xdgStateHome, "simple-english", "observations")
  const files = await readdir(directory).catch(() => [])
  const texts = await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")))
  return texts.flatMap((text) =>
    text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Observation),
  )
}

const request = (cwd: string, text: string): string =>
  JSON.stringify({ session_id: "reply-session", cwd, text })

describe("simple-english reply-check", () => {
  test("gives no feedback and records nothing for a reply with no hard violation", async () => {
    const cwd = await makeDirectory("ste-reply-check-")
    const xdgStateHome = await makeDirectory("ste-reply-state-")

    const result = await runCli(["reply-check"], {
      stdin: request(cwd, "Close the valve."),
      xdgStateHome,
    })

    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(JSON.parse(result.stdout)).toEqual({})
    await expect(observations(xdgStateHome)).resolves.toEqual([])
  })

  test("gives the hard violation details and records a denied reply", async () => {
    const cwd = await makeDirectory("ste-reply-check-")
    const xdgStateHome = await makeDirectory("ste-reply-state-")

    const result = await runCli(["reply-check"], {
      stdin: request(cwd, "This isn't permitted."),
      xdgStateHome,
    })

    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(JSON.parse(result.stdout)).toEqual({
      feedback: expect.stringMatching(
        /^Writing rules blocked reply for assistant reply:\n- line 1, column 6 \[contraction\]: /u,
      ),
    })
    await expect(observations(xdgStateHome)).resolves.toEqual([
      expect.objectContaining({
        event: "reply",
        sessionId: "reply-session",
        cwd,
        kind: "prose-file",
        decision: "deny",
        findings: [expect.objectContaining({ ruleId: "contraction", severity: "hard" })],
      }),
    ])
  })

  test("uses the project config of the given working directory", async () => {
    const cwd = await makeDirectory("ste-reply-check-")
    await writeFile(
      join(cwd, ".simple-english.json"),
      JSON.stringify({ rules: { contraction: "off" } }),
    )

    const result = await runCli(["reply-check"], {
      stdin: request(cwd, "This isn't permitted."),
      xdgStateHome: await makeDirectory("ste-reply-state-"),
    })

    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(JSON.parse(result.stdout)).toEqual({})
  })

  test("fails with exit code 2 when the request is not valid", async () => {
    const malformed = await runCli(["reply-check"], { stdin: "{" })
    const incomplete = await runCli(["reply-check"], {
      stdin: JSON.stringify({ session_id: "reply-session", cwd: "/tmp" }),
    })

    expect(malformed).toMatchObject({ code: 2, stdout: "" })
    expect(incomplete).toMatchObject({ code: 2, stdout: "", stderr: "text must be a string\n" })
  })

  test("rejects a flag", async () => {
    const result = await runCli(["reply-check", "--json"], { stdin: "{}" })

    expect(result).toMatchObject({ code: 2, stdout: "", stderr: 'unknown flag "--json"\n' })
  })
})
