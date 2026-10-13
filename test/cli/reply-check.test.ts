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

  test("gives no feedback for vertical lists directly below a label line", async () => {
    const cwd = await makeDirectory("ste-reply-check-")
    const reply = [
      "**B. Second group**",
      "5. `epsilon` - explains how one part works. It reads the code. **yes**",
      "6. `zeta` - finds the cause of a change. It reads the history. **yes**",
      "7. `eta` - gives one plain answer. It replaces the old tool. **no**",
      "8. `theta` - finds what a change can break. It shows real code. **yes**",
      "",
      "**C. Names**",
      "- 29 `attack-the-premise`, 30 `boundary-discipline`, 31 `build-the-lever`, 32 `encode-lessons`",
      "- 33 `exhaust-the-design-space`, 34 `experience-first`, 35 `explain-the-number`, 36 `fix-root-causes`",
      "- 37 `foundational-thinking`, 38 `guard-the-context`, 39 `laziness-protocol`, 40 `make-idempotent`",
      "- 41 `migrate-callers`, 42 `minimize-reader-load`, 43 `model-the-domain`, 44 `never-block`",
    ].join("\n")

    const result = await runCli(["reply-check"], {
      stdin: request(cwd, reply),
      xdgStateHome: await makeDirectory("ste-reply-state-"),
    })

    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(JSON.parse(result.stdout)).toEqual({})
  })

  test("gives the length feedback for one list item that is too long", async () => {
    const cwd = await makeDirectory("ste-reply-check-")
    const reply = [
      "**B. Second group**",
      "5. Open the valve. Read the gauge. Write the value. Close the valve. Stop. Wait. Go.",
      "6. Close the door.",
      "",
      "**C. Names**",
      `- ${Array.from({ length: 26 }, (_, index) => `name${index + 1}`).join(" ")}`,
      "- alpha, beta",
    ].join("\n")

    const result = await runCli(["reply-check"], {
      stdin: request(cwd, reply),
      xdgStateHome: await makeDirectory("ste-reply-state-"),
    })

    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(JSON.parse(result.stdout)).toEqual({
      feedback: [
        "Writing rules blocked reply for assistant reply:",
        "- line 2, column 1 [paragraph-length]: Paragraph has 7 sentences; the maximum is 6. Suggested fix: Split the paragraph into shorter paragraphs.",
        "- line 6, column 3 [sentence-length]: Sentence has 26 words; the maximum is 25. Suggested fix: Split the sentence into shorter sentences.",
      ].join("\n"),
    })
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
