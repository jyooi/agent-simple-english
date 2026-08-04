import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { runCli } from "./run-cli.ts"

interface Finding {
  readonly index: number
  readonly ruleId: string
  readonly severity: "hard" | "soft"
  readonly message: string
  readonly snippet: string
  readonly line: number
  readonly column: number
}

interface Observation {
  readonly id: string
  readonly at: string
  readonly surface: "claude-code-hook"
  readonly event: "write" | "edit" | "commit-message" | "reply"
  readonly sessionId: string
  readonly cwd: string
  readonly path?: string
  readonly kind: "prose-file" | "slash-source" | "hash-source" | "commit-message"
  readonly decision: "allow" | "deny"
  readonly textHash: string
  readonly findings: readonly Finding[]
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

async function makeTemp(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(path)
  return path
}

function preToolEvent(
  cwd: string,
  toolName: "Write" | "Edit" | "Bash",
  toolInput: object,
  sessionId = "observe-session",
): string {
  return JSON.stringify({
    session_id: sessionId,
    transcript_path: join(cwd, "transcript.jsonl"),
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "tool-1",
  })
}

function stopEvent(cwd: string, text: string, sessionId = "observe-session"): string {
  return JSON.stringify({
    session_id: sessionId,
    transcript_path: join(cwd, "transcript.jsonl"),
    cwd,
    permission_mode: "default",
    hook_event_name: "Stop",
    stop_hook_active: false,
    last_assistant_message: text,
  })
}

async function runHook(raw: string, cwd: string, xdgStateHome: string, observe?: string) {
  return runCli(["hook"], { stdin: raw, cwd, xdgStateHome, observe })
}

async function readObservations(xdgStateHome: string): Promise<Observation[]> {
  const directory = join(xdgStateHome, "simple-english", "observations")
  const files = (await readdir(directory)).sort()
  const lines = await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")))
  return lines
    .flatMap((text) => text.trim().split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Observation)
}

function observation(
  overrides: Partial<Observation> & Pick<Observation, "id" | "findings">,
): Observation {
  return {
    id: overrides.id,
    at: overrides.at ?? "2026-08-04T10:00:00.000Z",
    surface: "claude-code-hook",
    event: overrides.event ?? "write",
    sessionId: overrides.sessionId ?? "seed-session",
    cwd: overrides.cwd ?? "/tmp/project",
    path: overrides.path ?? "/tmp/project/notes.md",
    kind: overrides.kind ?? "prose-file",
    decision: overrides.decision ?? "deny",
    textHash: overrides.textHash ?? `sha256:${"a".repeat(64)}`,
    findings: overrides.findings,
  }
}

function finding(index: number, ruleId: string): Finding {
  return {
    index,
    ruleId,
    severity: "hard",
    message: `${ruleId} message`,
    snippet: `${ruleId} snippet.`,
    line: 1,
    column: 1,
  }
}

async function seedObservations(
  xdgStateHome: string,
  records: readonly Observation[],
): Promise<void> {
  const directory = join(xdgStateHome, "simple-english", "observations")
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, "2026-08.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  )
}

describe("simple-english observation log", () => {
  test("logs write, edit, commit-message, and reply decisions with snippets", async () => {
    const cwd = await makeTemp("ste-observe-project-")
    const xdgStateHome = await makeTemp("ste-observe-state-")
    await writeFile(
      join(cwd, ".simple-english.json"),
      JSON.stringify({ rules: { "dictionary-not-approved-word": "off" } }),
    )
    const editPath = join(cwd, "edit.md")
    await writeFile(editPath, "Replace this sentence.")

    const write = await runHook(
      preToolEvent(cwd, "Write", {
        file_path: join(cwd, "write.md"),
        content: "This isn't permitted.",
      }),
      cwd,
      xdgStateHome,
    )
    const edit = await runHook(
      preToolEvent(cwd, "Edit", {
        file_path: editPath,
        old_string: "Replace this sentence.",
        new_string: "Close the valve.",
      }),
      cwd,
      xdgStateHome,
    )
    const commit = await runHook(
      preToolEvent(cwd, "Bash", { command: `git commit -m "fix: This isn't permitted."` }),
      cwd,
      xdgStateHome,
    )
    await writeFile(
      join(cwd, "transcript.jsonl"),
      `${JSON.stringify({
        type: "user",
        uuid: "prompt-1",
        message: { role: "user", content: "Check this text." },
      })}\n`,
    )
    const reply = await runHook(
      stopEvent(cwd, "It is important to note that the valve is open."),
      cwd,
      xdgStateHome,
    )

    expect(JSON.parse(write.stdout).hookSpecificOutput.permissionDecision).toBe("deny")
    expect(JSON.parse(edit.stdout).hookSpecificOutput.permissionDecision).toBe("allow")
    expect(JSON.parse(commit.stdout).hookSpecificOutput.permissionDecision).toBe("deny")
    expect(JSON.parse(reply.stdout)).toEqual({})

    const records = await readObservations(xdgStateHome)
    expect(records.map((record) => record.event)).toEqual([
      "write",
      "edit",
      "commit-message",
      "reply",
    ])
    expect(records.map((record) => record.decision)).toEqual(["deny", "allow", "deny", "allow"])
    expect(records[0]).toMatchObject({
      surface: "claude-code-hook",
      sessionId: "observe-session",
      cwd,
      path: join(cwd, "write.md"),
      kind: "prose-file",
    })
    expect(records[0]?.id).toEqual(expect.any(String))
    expect(records[0]?.at).toEqual(expect.any(String))
    expect(records[0]?.textHash).toMatch(/^sha256:[0-9a-f]{64}$/u)
    expect(records[0]?.findings[0]).toMatchObject({
      index: 0,
      ruleId: "contraction",
      severity: "hard",
      snippet: "This isn't permitted.",
      line: 1,
      column: 6,
    })
    expect(records[1]?.findings).toEqual([])
    expect(records[2]?.findings[0]?.snippet).toBe("fix: This isn't permitted.")
    expect(records[3]?.findings).toEqual([
      expect.objectContaining({
        index: 0,
        ruleId: "hedging",
        severity: "soft",
        snippet: "It is important to note that the valve is open.",
      }),
    ])
    expect(records[3]).not.toHaveProperty("path")
  }, 15_000)

  test("logs clean allows and leaves plain CLI runs silent", async () => {
    const cwd = await makeTemp("ste-observe-project-")
    const xdgStateHome = await makeTemp("ste-observe-state-")

    const clean = await runHook(
      preToolEvent(cwd, "Write", {
        file_path: join(cwd, "notes.md"),
        content: "Close the valve.",
      }),
      cwd,
      xdgStateHome,
    )
    await runCli([], { stdin: "This isn't permitted.", cwd, xdgStateHome })

    expect(JSON.parse(clean.stdout).hookSpecificOutput.permissionDecision).toBe("allow")
    const records = await readObservations(xdgStateHome)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ decision: "allow", findings: [] })
  })

  test("does not log commit denials without a static message", async () => {
    const cwd = await makeTemp("ste-observe-project-")
    const xdgStateHome = await makeTemp("ste-observe-state-")

    const result = await runHook(
      preToolEvent(cwd, "Bash", { command: "git commit" }),
      cwd,
      xdgStateHome,
    )

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny")
    await expect(readdir(join(xdgStateHome, "simple-english", "observations"))).rejects.toThrow()
  })

  test("honors the observation kill switch", async () => {
    const cwd = await makeTemp("ste-observe-project-")
    const xdgStateHome = await makeTemp("ste-observe-state-")

    const result = await runHook(
      preToolEvent(cwd, "Write", {
        file_path: join(cwd, "notes.md"),
        content: "Close the valve.",
      }),
      cwd,
      xdgStateHome,
      "0",
    )

    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("allow")
    await expect(readdir(join(xdgStateHome, "simple-english", "observations"))).rejects.toThrow()
  })

  test("keeps the hook decision unchanged when observation storage fails", async () => {
    const cwd = await makeTemp("ste-observe-project-")
    const writableState = await makeTemp("ste-observe-state-")
    const blockedStateParent = await makeTemp("ste-observe-blocked-")
    const blockedState = join(blockedStateParent, "state")
    await mkdir(join(blockedState, "simple-english"), { recursive: true })
    await writeFile(join(blockedState, "simple-english", "observations"), "not a directory")
    const raw = preToolEvent(cwd, "Write", {
      file_path: join(cwd, "notes.md"),
      content: "This isn't permitted.",
    })

    const baseline = await runHook(raw, cwd, writableState, "0")
    const failedLog = await runHook(raw, cwd, blockedState)

    expect(failedLog).toEqual(baseline)
  })

  test("logs nothing for a disabled session", async () => {
    const cwd = await makeTemp("ste-observe-project-")
    const xdgStateHome = await makeTemp("ste-observe-state-")
    const disabled = await runCli(["session", "disabled-session", cwd, "off"], {
      cwd,
      xdgStateHome,
    })

    const result = await runHook(
      preToolEvent(
        cwd,
        "Write",
        { file_path: join(cwd, "notes.md"), content: "This isn't permitted." },
        "disabled-session",
      ),
      cwd,
      xdgStateHome,
    )

    expect(disabled.code).toBe(0)
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("allow")
    await expect(readdir(join(xdgStateHome, "simple-english", "observations"))).rejects.toThrow()
  })

  test("reviews unjudged findings and records notes while skips stay unjudged", async () => {
    const xdgStateHome = await makeTemp("ste-observe-state-")
    await seedObservations(xdgStateHome, [
      observation({ id: "observation-1", findings: [finding(0, "contraction")] }),
      observation({ id: "observation-2", findings: [finding(0, "semicolon")] }),
    ])

    const result = await runCli(["observe", "review"], {
      xdgStateHome,
      stdin: "f\nKnown quoted text.\ns\n",
    })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain("contraction snippet.")
    expect(result.stdout).toContain("semicolon snippet.")
    const verdictLines = (
      await readFile(join(xdgStateHome, "simple-english", "verdicts.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(verdictLines).toEqual([
      expect.objectContaining({
        observationId: "observation-1",
        findingIndex: 0,
        verdict: "false-positive",
        note: "Known quoted text.",
      }),
    ])
  })

  test("aggregates stats by rule and uses the latest verdict", async () => {
    const xdgStateHome = await makeTemp("ste-observe-state-")
    await seedObservations(xdgStateHome, [
      observation({
        id: "observation-1",
        findings: [finding(0, "contraction"), finding(1, "semicolon")],
      }),
      observation({ id: "observation-2", findings: [finding(0, "contraction")] }),
      observation({ id: "observation-3", decision: "allow", findings: [] }),
    ])
    const stateDirectory = join(xdgStateHome, "simple-english")
    await writeFile(
      join(stateDirectory, "verdicts.jsonl"),
      `${[
        {
          at: "2026-08-04T10:01:00.000Z",
          observationId: "observation-1",
          findingIndex: 0,
          verdict: "false-positive",
        },
        {
          at: "2026-08-04T10:02:00.000Z",
          observationId: "observation-1",
          findingIndex: 0,
          verdict: "true-positive",
        },
        {
          at: "2026-08-04T10:03:00.000Z",
          observationId: "observation-2",
          findingIndex: 0,
          verdict: "false-positive",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
    )

    const result = await runCli(["observe", "stats"], { xdgStateHome })

    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(result.stdout).toContain("Observations: 3")
    expect(result.stdout).toContain("Clean allows: 1")
    expect(result.stdout).toMatch(/contraction\s+2\s+2\s+50\.0%/u)
    expect(result.stdout).toMatch(/semicolon\s+1\s+0\s+-/u)
  })
})
