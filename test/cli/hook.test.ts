import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { repoRoot, runCli } from "./run-cli.ts"

interface HookSpecificOutput {
  readonly hookEventName: string
  readonly permissionDecision?: string
  readonly permissionDecisionReason?: string
  readonly additionalContext?: string
}

interface HookOutput {
  readonly continue?: boolean
  readonly decision?: "block"
  readonly reason?: string
  readonly systemMessage?: string
  readonly hookSpecificOutput?: HookSpecificOutput
}

interface SessionState {
  readonly version: number
  readonly enabled: boolean
  readonly strict: boolean
  readonly lastProcessedReply?: string
  readonly pendingFeedback?: string
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function makeProject(config?: object): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "ste-hook-"))
  temporaryDirectories.push(cwd)
  if (config !== undefined) {
    await writeFile(join(cwd, ".simple-english.json"), JSON.stringify(config))
  }
  return cwd
}

const approvedWordList = (approvedWords: readonly string[]) => ({
  formatVersion: 1,
  source: {
    name: "synthetic test fixture",
    repository: "https://example.test/approved-words",
    commit: "fixture",
    path: "approved-words.json",
  },
  approvedWords,
})

function event(
  cwd: string,
  toolName: "Write" | "Edit" | "Bash",
  toolInput: object,
  sessionId = "session-1",
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

function sessionStartEvent(cwd: string): string {
  return JSON.stringify({
    session_id: "session-1",
    transcript_path: join(cwd, "transcript.jsonl"),
    cwd,
    permission_mode: "default",
    hook_event_name: "SessionStart",
    source: "startup",
  })
}

function stopEvent(
  cwd: string,
  sessionId: string,
  transcriptPath: string,
  lastAssistantMessage?: string,
  stopHookActive = false,
): string {
  return JSON.stringify({
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd,
    permission_mode: "default",
    hook_event_name: "Stop",
    stop_hook_active: stopHookActive,
    ...(lastAssistantMessage === undefined ? {} : { last_assistant_message: lastAssistantMessage }),
  })
}

function userPromptEvent(cwd: string, sessionId: string): string {
  return JSON.stringify({
    session_id: sessionId,
    transcript_path: join(cwd, `${sessionId}.jsonl`),
    cwd,
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit",
    prompt: "Continue.",
  })
}

function transcriptEntry(reply: string, uuid: string): string {
  return `${JSON.stringify({
    type: "assistant",
    uuid,
    message: { role: "assistant", content: [{ type: "text", text: reply }] },
  })}\n`
}

function promptEntry(prompt: string, uuid: string): string {
  return `${JSON.stringify({
    type: "user",
    uuid,
    message: { role: "user", content: prompt },
  })}\n`
}

async function writeTranscript(path: string, reply: string, uuid = "reply-1"): Promise<void> {
  await writeFile(path, transcriptEntry(reply, uuid))
}

async function stateFiles(xdgStateHome: string): Promise<string[]> {
  try {
    return await readdir(join(xdgStateHome, "simple-english", "sessions"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

async function runHook(
  stdin: string,
  cwd?: string,
  preload?: string,
  xdgConfigHome?: string,
  dictionaryPath?: string,
  agentDir?: string,
  xdgStateHome?: string,
) {
  const result = await runCli(["hook"], {
    stdin,
    cwd,
    preload,
    xdgConfigHome,
    xdgStateHome,
    dictionaryPath,
    agentDir,
  })
  return { ...result, output: JSON.parse(result.stdout) as HookOutput }
}

function runReplyHook(stdin: string, cwd: string, xdgStateHome: string) {
  return runHook(stdin, cwd, undefined, undefined, undefined, undefined, xdgStateHome)
}

function runSessionCommand(
  sessionId: string,
  cwd: string,
  command: string,
  xdgStateHome: string,
  dictionaryPath?: string,
) {
  return runCli(["session", sessionId, cwd, command], {
    cwd,
    xdgStateHome,
    dictionaryPath,
  })
}

function decision(output: HookOutput): HookSpecificOutput {
  expect(output.hookSpecificOutput).toBeDefined()
  return output.hookSpecificOutput as HookSpecificOutput
}

describe("simple-english CLI hook mode", () => {
  test("disables every hook gate for only the selected session and enables it again", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const violatingWrite = (sessionId: string) =>
      event(
        cwd,
        "Write",
        {
          file_path: join(cwd, "notes.md"),
          content: "This isn't permitted.",
        },
        sessionId,
      )

    const disabled = await runSessionCommand("session-1", cwd, "off", xdgStateHome)
    const disabledWrite = await runReplyHook(violatingWrite("session-1"), cwd, xdgStateHome)
    const parallelWrite = await runReplyHook(violatingWrite("session-2"), cwd, xdgStateHome)
    const disabledStart = await runReplyHook(sessionStartEvent(cwd), cwd, xdgStateHome)
    const transcriptPath = join(cwd, "disabled-session.jsonl")
    await writeFile(transcriptPath, promptEntry("Check it.", "prompt-1"))
    const disabledStop = await runReplyHook(
      stopEvent(cwd, "session-1", transcriptPath, "This isn't permitted."),
      cwd,
      xdgStateHome,
    )
    const disabledPrompt = await runReplyHook(userPromptEvent(cwd, "session-1"), cwd, xdgStateHome)

    expect(disabled).toMatchObject({ code: 0, stdout: "Writing-rule enforcement disabled.\n" })
    expect(decision(disabledWrite.output).permissionDecision).toBe("allow")
    expect(decision(parallelWrite.output).permissionDecision).toBe("deny")
    expect(disabledStart.output).toEqual({})
    expect(disabledStop.output).toEqual({})
    expect(disabledPrompt.output).toEqual({})
    const disabledFiles = await stateFiles(xdgStateHome)
    expect(disabledFiles).toHaveLength(1)
    const disabledState = JSON.parse(
      await readFile(
        join(xdgStateHome, "simple-english", "sessions", disabledFiles[0] as string),
        "utf8",
      ),
    ) as SessionState
    expect(disabledState).toMatchObject({ version: 3, enabled: false, strict: false })

    const enabled = await runSessionCommand("session-1", cwd, "on", xdgStateHome)
    const enabledWrite = await runReplyHook(violatingWrite("session-1"), cwd, xdgStateHome)

    expect(enabled).toMatchObject({ code: 0, stdout: "Writing-rule enforcement enabled.\n" })
    expect(decision(enabledWrite.output).permissionDecision).toBe("deny")
    const enabledState = JSON.parse(
      await readFile(
        join(xdgStateHome, "simple-english", "sessions", disabledFiles[0] as string),
        "utf8",
      ),
    ) as SessionState
    expect(enabledState).toMatchObject({ version: 3, enabled: true, strict: false })
  }, 15_000)

  test("starts a new session in enabled non-strict mode", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    await runSessionCommand("old-session", cwd, "strict", xdgStateHome)
    await runSessionCommand("old-session", cwd, "off", xdgStateHome)

    const result = await runReplyHook(
      event(
        cwd,
        "Write",
        { file_path: join(cwd, "notes.md"), content: "This isn't permitted." },
        "new-session",
      ),
      cwd,
      xdgStateHome,
    )

    expect(decision(result.output).permissionDecision).toBe("deny")
  })

  test("reports session mode, rule counts, and dictionary state", async () => {
    const cwd = await makeProject({
      rules: { contraction: "off", semicolon: "soft" },
    })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    await runSessionCommand("session-1", cwd, "off", xdgStateHome)

    const status = await runSessionCommand("session-1", cwd, "status", xdgStateHome)

    expect(status.code).toBe(0)
    expect(status.stdout).toContain("Mode: disabled")
    expect(status.stdout).toContain("Rules: 7 hard, 4 soft, 1 off")
    expect(status.stdout).toContain("Dictionary: loaded")

    const failedDictionary = await runSessionCommand(
      "session-1",
      cwd,
      "status",
      xdgStateHome,
      join(cwd, "missing-dictionary.json"),
    )
    expect(failedDictionary.code).toBe(0)
    expect(failedDictionary.stdout).toContain("Dictionary: failed (")
    expect(failedDictionary.stdout).toContain("missing-dictionary.json")
  })

  test("reports approved-word list status with dictionary precedence", async () => {
    const cwd = await makeProject({ approvedWordsPath: "approved-words.json" })
    const approvedWordsPath = join(cwd, "approved-words.json")
    await writeFile(approvedWordsPath, JSON.stringify(approvedWordList(["alphaword"])))
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)

    const loaded = await runSessionCommand(
      "session-1",
      cwd,
      "status",
      xdgStateHome,
      join(cwd, "missing-dictionary.json"),
    )

    expect(loaded.stdout).toContain("Dictionary: loaded")

    await rm(approvedWordsPath)
    const missing = await runSessionCommand("session-1", cwd, "status", xdgStateHome)
    expect(missing.stdout).toContain("Dictionary: failed (")
    expect(missing.stdout).toContain("approved-words.json")
  })

  test("reports unavailable status details when config loading fails", async () => {
    const cwd = await makeProject()
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    await writeFile(join(cwd, ".simple-english.json"), "{")
    await runSessionCommand("session-1", cwd, "off", xdgStateHome)

    const status = await runSessionCommand("session-1", cwd, "status", xdgStateHome)

    expect(status.code).toBe(0)
    expect(status.stdout).toContain("Mode: disabled")
    expect(status.stdout).toContain("Config: failed (invalid JSON in")
    expect(status.stdout).toContain(join(cwd, ".simple-english.json"))
    expect(status.stdout).toContain("Rules: unavailable")
    expect(status.stdout).toContain("Dictionary: unavailable")
    expect(status.stdout).not.toMatch(/Rules: \d+ hard/)
  })

  test("blocks one strict Stop, then allows the clean rewrite Stop", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const transcriptPath = join(cwd, "strict-session.jsonl")
    await writeFile(transcriptPath, promptEntry("Check it.", "prompt-1"))
    await runSessionCommand("strict-session", cwd, "strict", xdgStateHome)
    const strictFiles = await stateFiles(xdgStateHome)
    const strictState = JSON.parse(
      await readFile(
        join(xdgStateHome, "simple-english", "sessions", strictFiles[0] as string),
        "utf8",
      ),
    ) as SessionState
    expect(strictState).toMatchObject({ version: 3, enabled: true, strict: true })

    const blocked = await runReplyHook(
      stopEvent(cwd, "strict-session", transcriptPath, "This isn't permitted."),
      cwd,
      xdgStateHome,
    )
    const rewritten = await runReplyHook(
      stopEvent(cwd, "strict-session", transcriptPath, "Close the valve.", true),
      cwd,
      xdgStateHome,
    )

    expect(blocked.output.decision).toBe("block")
    expect(blocked.output.reason).toContain("[contraction]")
    expect(rewritten.output).toEqual({})
  })

  test("never blocks an already active Stop hook", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const transcriptPath = join(cwd, "active-session.jsonl")
    await writeFile(transcriptPath, promptEntry("Check it.", "prompt-1"))
    await runSessionCommand("active-session", cwd, "strict", xdgStateHome)

    const result = await runReplyHook(
      stopEvent(cwd, "active-session", transcriptPath, "This isn't permitted.", true),
      cwd,
      xdgStateHome,
    )

    expect(result.output).toEqual({})
  })

  test("records deferred feedback from an active Stop after strict mode is off", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const transcriptPath = join(cwd, "strict-off-session.jsonl")
    await writeFile(transcriptPath, promptEntry("Check it.", "prompt-1"))
    await runSessionCommand("strict-off-session", cwd, "strict", xdgStateHome)

    const disabled = await runSessionCommand("strict-off-session", cwd, "strict off", xdgStateHome)
    const stopped = await runReplyHook(
      stopEvent(cwd, "strict-off-session", transcriptPath, "This isn't permitted.", true),
      cwd,
      xdgStateHome,
    )
    const submitted = await runReplyHook(
      userPromptEvent(cwd, "strict-off-session"),
      cwd,
      xdgStateHome,
    )

    expect(disabled).toMatchObject({ code: 0, stdout: "Writing-rule strict mode disabled.\n" })
    expect(stopped.output).toEqual({})
    expect(decision(submitted.output).additionalContext).toContain("[contraction]")
  })

  test("records rewritten feedback after a clean Stop and strict off", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const transcriptPath = join(cwd, "strict-off-rewrite-session.jsonl")
    await writeFile(transcriptPath, promptEntry("Check it.", "prompt-1"))
    await runSessionCommand("strict-off-rewrite-session", cwd, "strict", xdgStateHome)

    const cleanStop = await runReplyHook(
      stopEvent(cwd, "strict-off-rewrite-session", transcriptPath, "Close the valve."),
      cwd,
      xdgStateHome,
    )
    await runSessionCommand("strict-off-rewrite-session", cwd, "strict off", xdgStateHome)
    const rewrittenStop = await runReplyHook(
      stopEvent(cwd, "strict-off-rewrite-session", transcriptPath, "This isn't permitted.", true),
      cwd,
      xdgStateHome,
    )
    const submitted = await runReplyHook(
      userPromptEvent(cwd, "strict-off-rewrite-session"),
      cwd,
      xdgStateHome,
    )

    expect(cleanStop.output).toEqual({})
    expect(rewrittenStop.output).toEqual({})
    expect(decision(submitted.output).additionalContext).toContain("[contraction]")
  })

  test("rejects an invalid session command without changing state", async () => {
    const cwd = await makeProject()
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)

    const result = await runSessionCommand("session-1", cwd, "invalid", xdgStateHome)

    expect(result.code).toBe(2)
    expect(result.stderr).toContain("Usage: /ase [on|off|status|strict|strict off]")
    expect(await stateFiles(xdgStateHome)).toEqual([])
  })

  test("records hard reply feedback, injects it once, and clears pending feedback", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const transcriptPath = join(cwd, "session-1.jsonl")
    await writeTranscript(
      transcriptPath,
      "It is important to note that we can't carry out the test; close the valve.",
    )

    const stopped = await runReplyHook(
      stopEvent(cwd, "session-1", transcriptPath),
      cwd,
      xdgStateHome,
    )

    expect(stopped.code).toBe(0)
    expect(stopped.output).toEqual({})
    const files = await stateFiles(xdgStateHome)
    expect(files).toHaveLength(1)
    const state = JSON.parse(
      await readFile(join(xdgStateHome, "simple-english", "sessions", files[0] as string), "utf8"),
    ) as SessionState
    expect(state.pendingFeedback).toContain("line 1, column 33 [contraction]")
    expect(state.pendingFeedback).toContain("[phrasal-verb]")
    expect(state.pendingFeedback).toContain("[semicolon]")
    expect(state.pendingFeedback).toContain("Suggested fix:")
    expect(state.pendingFeedback).not.toContain("[hedging]")

    const submitted = await runReplyHook(userPromptEvent(cwd, "session-1"), cwd, xdgStateHome)

    expect(submitted.code).toBe(0)
    const output = decision(submitted.output)
    expect(output.hookEventName).toBe("UserPromptSubmit")
    expect(output.additionalContext).toBe(state.pendingFeedback)
    expect(await stateFiles(xdgStateHome)).toEqual(files)
    const consumedState = JSON.parse(
      await readFile(join(xdgStateHome, "simple-english", "sessions", files[0] as string), "utf8"),
    ) as SessionState
    expect(consumedState.lastProcessedReply).toBe("uuid:reply-1")
    expect(consumedState.pendingFeedback).toBeUndefined()

    const submittedAgain = await runReplyHook(userPromptEvent(cwd, "session-1"), cwd, xdgStateHome)
    expect(submittedAgain.output).toEqual({})
  })

  test("ignores duplicate Stops and records a new reply", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const transcriptPath = join(cwd, "session-1.jsonl")
    await writeTranscript(transcriptPath, "This isn't permitted.")

    await runReplyHook(stopEvent(cwd, "session-1", transcriptPath), cwd, xdgStateHome)
    const firstSubmission = await runReplyHook(userPromptEvent(cwd, "session-1"), cwd, xdgStateHome)
    expect(decision(firstSubmission.output).additionalContext).toContain("[contraction]")

    await runReplyHook(stopEvent(cwd, "session-1", transcriptPath), cwd, xdgStateHome)
    const duplicateSubmission = await runReplyHook(
      userPromptEvent(cwd, "session-1"),
      cwd,
      xdgStateHome,
    )
    expect(duplicateSubmission.output).toEqual({})

    await appendFile(transcriptPath, transcriptEntry("This can't continue.", "reply-2"))
    await runReplyHook(stopEvent(cwd, "session-1", transcriptPath), cwd, xdgStateHome)
    const secondSubmission = await runReplyHook(
      userPromptEvent(cwd, "session-1"),
      cwd,
      xdgStateHome,
    )
    expect(decision(secondSubmission.output).additionalContext).toContain("[contraction]")
  })

  test("uses the Stop reply and distinguishes identical replies by prompt", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const transcriptPath = join(cwd, "lagged-session.jsonl")
    await writeFile(
      transcriptPath,
      `${transcriptEntry("Close the valve.", "older-reply")}${promptEntry("Check it.", "prompt-1")}`,
    )
    const firstStop = stopEvent(cwd, "lagged-session", transcriptPath, "This isn't permitted.")

    await runReplyHook(firstStop, cwd, xdgStateHome)
    const firstSubmission = await runReplyHook(
      userPromptEvent(cwd, "lagged-session"),
      cwd,
      xdgStateHome,
    )
    expect(decision(firstSubmission.output).additionalContext).toContain("[contraction]")

    await runReplyHook(firstStop, cwd, xdgStateHome)
    const duplicateSubmission = await runReplyHook(
      userPromptEvent(cwd, "lagged-session"),
      cwd,
      xdgStateHome,
    )
    expect(duplicateSubmission.output).toEqual({})

    await appendFile(transcriptPath, promptEntry("Check it again.", "prompt-2"))
    await runReplyHook(firstStop, cwd, xdgStateHome)
    const secondSubmission = await runReplyHook(
      userPromptEvent(cwd, "lagged-session"),
      cwd,
      xdgStateHome,
    )
    expect(decision(secondSubmission.output).additionalContext).toContain("[contraction]")
  })

  test("does not record clean or soft-only reply feedback", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)

    const cleanTranscriptPath = join(cwd, "clean-session.jsonl")
    await writeTranscript(cleanTranscriptPath, "This isn't permitted.")
    await runReplyHook(stopEvent(cwd, "clean-session", cleanTranscriptPath), cwd, xdgStateHome)
    expect(await stateFiles(xdgStateHome)).toHaveLength(1)

    for (const [sessionId, reply] of [
      ["clean-session", "Close the valve."],
      ["soft-session", "It is important to note that the valve is open."],
    ] as const) {
      const transcriptPath = join(cwd, `${sessionId}.jsonl`)
      await writeTranscript(transcriptPath, reply, `${sessionId}-clean-reply`)
      const result = await runReplyHook(
        stopEvent(cwd, sessionId, transcriptPath),
        cwd,
        xdgStateHome,
      )
      expect(result.code).toBe(0)
      expect(result.output).toEqual({})
    }

    const files = await stateFiles(xdgStateHome)
    expect(files).toHaveLength(2)
    const states = await Promise.all(
      files.map(
        async (file) =>
          JSON.parse(
            await readFile(join(xdgStateHome, "simple-english", "sessions", file), "utf8"),
          ) as SessionState,
      ),
    )
    expect(states.every((state) => state.pendingFeedback === undefined)).toBe(true)
  })

  test("reads a large transcript from the end", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const transcriptPath = join(cwd, "large-session.jsonl")
    const toolEntry = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: "x".repeat(2 * 1024 * 1024) }],
      },
    })
    const assistantEntry = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "x".repeat(128 * 1024) },
          { type: "text", text: "This isn't permitted." },
        ],
      },
    })
    await writeFile(transcriptPath, `${toolEntry}\n${assistantEntry}\n`)

    const stopped = await runHook(
      stopEvent(cwd, "large-session", transcriptPath),
      cwd,
      join(repoRoot, "test", "fixtures", "failing-large-transcript-read-preload.js"),
      undefined,
      undefined,
      undefined,
      xdgStateHome,
    )
    const submitted = await runReplyHook(userPromptEvent(cwd, "large-session"), cwd, xdgStateHome)

    expect(stopped.code).toBe(0)
    expect(stopped.output).toEqual({})
    expect(decision(submitted.output).additionalContext).toContain("[contraction]")
    expect(await stateFiles(xdgStateHome)).toHaveLength(1)
  })

  test("skips a large trailing non-assistant transcript entry", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const transcriptPath = join(cwd, "trailing-tool-session.jsonl")
    const assistantEntry = transcriptEntry("This isn't permitted.", "reply-before-tool")
    const toolEntry = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: "x".repeat(2 * 1024 * 1024) }],
      },
    })
    await writeFile(transcriptPath, `${assistantEntry}${toolEntry}\n`)

    const stopped = await runHook(
      stopEvent(cwd, "trailing-tool-session", transcriptPath),
      cwd,
      join(repoRoot, "test", "fixtures", "failing-large-transcript-read-preload.js"),
      undefined,
      undefined,
      undefined,
      xdgStateHome,
    )
    const submitted = await runReplyHook(
      userPromptEvent(cwd, "trailing-tool-session"),
      cwd,
      xdgStateHome,
    )

    expect(stopped.code).toBe(0)
    expect(stopped.output).toEqual({})
    expect(decision(submitted.output).additionalContext).toContain("[contraction]")
  })

  test("scopes pending reply feedback to one session", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)
    const transcriptPath = join(cwd, "first-session.jsonl")
    await writeTranscript(transcriptPath, "This isn't permitted.")

    await runReplyHook(stopEvent(cwd, "first-session", transcriptPath), cwd, xdgStateHome)

    const otherSession = await runReplyHook(
      userPromptEvent(cwd, "second-session"),
      cwd,
      xdgStateHome,
    )
    expect(otherSession.output).toEqual({})
    expect(await stateFiles(xdgStateHome)).toHaveLength(1)

    const firstSession = await runReplyHook(
      userPromptEvent(cwd, "first-session"),
      cwd,
      xdgStateHome,
    )
    expect(decision(firstSession.output).additionalContext).toContain("[contraction]")
    expect(await stateFiles(xdgStateHome)).toHaveLength(1)
  })

  test("allows Stop when the transcript cannot be read", async () => {
    const cwd = await makeProject()
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hook-state-"))
    temporaryDirectories.push(xdgStateHome)

    const result = await runReplyHook(
      stopEvent(cwd, "session-1", join(cwd, "missing.jsonl")),
      cwd,
      xdgStateHome,
    )

    expect(result.code).toBe(0)
    expect(result.output.continue).toBe(true)
    expect(result.output.systemMessage).toContain("Writing-rule hook error")
    expect(await stateFiles(xdgStateHome)).toEqual([])
  })

  test("adds the merged active rule summary to SessionStart context", async () => {
    const cwd = await makeProject({
      maxSentenceWords: 8,
      rules: { contraction: "off", semicolon: "soft" },
    })
    const xdgConfigHome = await mkdtemp(join(tmpdir(), "ste-hook-config-"))
    temporaryDirectories.push(xdgConfigHome)
    const configDirectory = join(xdgConfigHome, "simple-english")
    await mkdir(configDirectory)
    await writeFile(
      join(configDirectory, "config.json"),
      JSON.stringify({
        maxSentenceWords: 30,
        rules: { contraction: "hard", marketing: "hard", semicolon: "hard" },
      }),
    )

    const result = await runHook(sessionStartEvent(cwd), cwd, undefined, xdgConfigHome)

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.hookEventName).toBe("SessionStart")
    expect(output.additionalContext).toContain("Simplified Technical English")
    expect(output.additionalContext).toContain("[hard] Use factual language")
    expect(output.additionalContext).toContain("[soft] Do not use semicolons")
    expect(output.additionalContext).toContain("Keep each sentence to 8 words or fewer")
    expect(output.additionalContext).not.toContain("Do not use contractions")
  })

  test("adds SessionStart context without tagger setup", async () => {
    const cwd = await makeProject()

    const result = await runHook(
      sessionStartEvent(cwd),
      cwd,
      join(repoRoot, "test", "fixtures", "failing-tagger-preload.js"),
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.hookEventName).toBe("SessionStart")
    expect(output.additionalContext).toContain("Simplified Technical English")
  })

  test("uses an approved-word list from the event directory", async () => {
    const cwd = await makeProject({ approvedWordsPath: "approved-words.json" })
    await writeFile(
      join(cwd, "approved-words.json"),
      JSON.stringify(approvedWordList(["alphaword"])),
    )

    const approved = await runHook(
      event(cwd, "Write", {
        file_path: join(cwd, "approved.md"),
        content: "ALPHAWORD.",
      }),
      repoRoot,
    )
    const absent = await runHook(
      event(cwd, "Write", {
        file_path: join(cwd, "absent.md"),
        content: "Betaword.",
      }),
      repoRoot,
    )

    expect(decision(approved.output).permissionDecision).toBe("allow")
    expect(decision(absent.output).permissionDecision).toBe("deny")
    expect(decision(absent.output).permissionDecisionReason).toContain(
      '"Betaword" is not in the approved-word list.',
    )
  })

  test("allows a hook event with a warning when the approved-word list is missing", async () => {
    const cwd = await makeProject({ approvedWordsPath: "missing-approved-words.json" })
    const result = await runHook(
      event(cwd, "Write", {
        file_path: join(cwd, "notes.md"),
        content: "Alphaword.",
      }),
      repoRoot,
    )

    const output = decision(result.output)
    expect(output.permissionDecision).toBe("allow")
    expect(output.additionalContext).toContain("missing-approved-words.json")
    expect(output.additionalContext).toContain("event is allowed")
  })

  test("resolves a custom dictionary from the event directory", async () => {
    const cwd = await makeProject()
    const dictionaryPath = join(cwd, "dictionary.json")
    await copyFile(join(repoRoot, "test", "fixtures", "hyphenated-dictionary.json"), dictionaryPath)
    const input = event(cwd, "Write", {
      file_path: join(cwd, "notes.md"),
      content: "Use state-of-the-art parts.",
    })

    const relativeResult = await runHook(input, repoRoot, undefined, undefined, "dictionary.json")
    const absoluteResult = await runHook(input, repoRoot, undefined, undefined, dictionaryPath)

    for (const result of [relativeResult, absoluteResult]) {
      expect(result.code).toBe(0)
      const output = decision(result.output)
      expect(output.permissionDecision).toBe("deny")
      expect(output.permissionDecisionReason).toContain('Use "advanced", not "state-of-the-art".')
    }
  })

  test("resolves a relative legacy config directory from the event directory", async () => {
    const cwd = await makeProject()
    const agentDir = join(".pi", "agent")
    await mkdir(join(cwd, agentDir), { recursive: true })
    await writeFile(
      join(cwd, agentDir, "simple-english.json"),
      JSON.stringify({ rules: { "dictionary-not-approved-word": "off", marketing: "hard" } }),
    )

    const writeResult = await runHook(
      event(cwd, "Write", {
        file_path: join(cwd, "notes.md"),
        content: "Use robust parts.",
      }),
      repoRoot,
      undefined,
      undefined,
      undefined,
      agentDir,
    )
    const sessionResult = await runHook(
      sessionStartEvent(cwd),
      repoRoot,
      undefined,
      undefined,
      undefined,
      agentDir,
    )

    expect(writeResult.code).toBe(0)
    expect(decision(writeResult.output).permissionDecision).toBe("deny")
    expect(decision(writeResult.output).permissionDecisionReason).toContain("[marketing]")
    expect(sessionResult.code).toBe(0)
    expect(decision(sessionResult.output).additionalContext).toContain(
      "[hard] Use factual language",
    )
  })

  test("denies a Write event and lists every hard violation with a suggested fix", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const result = await runHook(
      event(cwd, "Write", {
        file_path: join(cwd, "notes.md"),
        content: "Carry out the test; this isn't permitted.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
    })
    expect(output.permissionDecisionReason).toContain("line 1, column 1 [phrasal-verb]")
    expect(output.permissionDecisionReason).toContain("line 1, column 19 [semicolon]")
    expect(output.permissionDecisionReason).toContain("line 1, column 26 [contraction]")
    expect(output.permissionDecisionReason?.match(/Suggested fix:/gu)).toHaveLength(3)
  })

  test("allows an Edit event when only untouched prose has a hard violation", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "This isn't compliant.\nReplace this sentence.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Replace this sentence.",
        new_string: "Keep this sentence.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    expect(decision(result.output)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    })
  })

  test("denies an Edit event for a hard violation in changed prose", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "This isn't compliant.\nReplace this sentence.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Replace this sentence.",
        new_string: "This isn't permitted.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 2, column 6 [contraction]")
  })

  test("denies an Edit that changes one local violation into another", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "Carry out the test.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Carry out the test.",
        new_string: "Spin up the test.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 1, column 1 [phrasal-verb]")
  })

  test("denies an Edit that moves a local violation within one sentence", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "Carry out and carry\nout.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Carry out and carry\nout.",
        new_string: "Carry\nout and carry out.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 2, column 9 [phrasal-verb]")
  })

  test("allows an Edit that shifts unchanged violating prose", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "Replace this sentence.\nCarry out the test.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Replace this sentence.",
        new_string: "Keep this sentence.\nAdd another sentence.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    expect(decision(result.output)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    })
  })

  test("allows an Edit beside an untouched local violation", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "Carry out the test.\nReplace this sentence.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Replace this sentence.",
        new_string: "Keep this sentence.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    expect(decision(result.output)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    })
  })

  test("denies an Edit that adds a seventh sentence to a paragraph", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "One. Two. Three. Four. Five. Six.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Six.",
        new_string: "Six. Seven.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 1, column 1 [paragraph-length]")
  })

  test("denies an Edit that merges paragraphs into seven sentences", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "One. Two. Three. Four.\n\nFive. Six. Seven.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Four.\n\nFive.",
        new_string: "Four.\nFive.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 1, column 1 [paragraph-length]")
  })

  test("denies an Edit that merges paragraphs by deleting a heading marker", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "One. Two. Three. Four.\n# Heading.\nFive. Six. Seven.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "# Heading.",
        new_string: "Heading.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 1, column 1 [paragraph-length]")
  })

  test("does not report an untouched paragraph with seven sentences", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "One. Two. Three. Four. Five. Six. Seven.\n\nReplace this sentence.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Replace this sentence.",
        new_string: "Keep this sentence.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    expect(decision(result.output)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    })
  })

  test("denies an Edit when a comment marker exposes retained source prose", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "sample.ts")
    await writeFile(path, 'const note = "Carry out the test."')

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "const note",
        new_string: "// const note",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 1, column 18 [phrasal-verb]")
  })

  test("denies an Edit event in a later source comment", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "sample.ts")
    await writeFile(
      path,
      ["/* Close the valve. */", "const value = 1", "/* Replace this sentence. */"].join("\n"),
    )

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Replace this sentence.",
        new_string: "This isn't permitted.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 3, column 9 [contraction]")
  })

  test("reconstructs an Edit event that replaces every match", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "Replace this sentence.\nReplace this sentence.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Replace this sentence.",
        new_string: "This isn't permitted.",
        replace_all: true,
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 1, column 6 [contraction]")
    expect(output.permissionDecisionReason).toContain("line 2, column 6 [contraction]")
  })

  test("inserts replace-all text literally", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const path = join(cwd, "notes.md")
    await writeFile(path, "This isn't permitted. Replace this sentence.")

    const result = await runHook(
      event(cwd, "Edit", {
        file_path: path,
        old_string: "Replace this sentence.",
        new_string: "Keep $& and $`.",
        replace_all: true,
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    expect(decision(result.output)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    })
  })

  test("gates a static git commit message", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const denied = await runHook(
      event(cwd, "Bash", { command: `git commit -m "fix: This isn't permitted."` }),
      cwd,
    )
    const allowed = await runHook(
      event(cwd, "Bash", { command: `git commit -m "fix: Close the valve."` }),
      cwd,
    )

    expect(denied.code).toBe(0)
    expect(decision(denied.output).permissionDecision).toBe("deny")
    expect(decision(denied.output).permissionDecisionReason).toContain(
      "line 1, column 11 [contraction]",
    )
    expect(allowed.code).toBe(0)
    expect(decision(allowed.output)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    })
  })

  test("gates a static commit after a leading redirection", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const result = await runHook(
      event(cwd, "Bash", {
        command: `>/tmp/log git commit -m "fix: This isn't permitted."`,
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 1, column 11 [contraction]")
  })

  test("gates a static commit in a command group", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const result = await runHook(
      event(cwd, "Bash", {
        command: `{ git commit -m "fix: This isn't permitted."; }`,
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("deny")
    expect(output.permissionDecisionReason).toContain("line 1, column 11 [contraction]")
  })

  test("ignores git commit text in a heredoc payload", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const result = await runHook(
      event(cwd, "Bash", {
        command: `cat <<'EOF'\ngit commit -m "fix: This isn't permitted."\nEOF`,
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    expect(decision(result.output)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    })
  })

  test.each(["git commit", "git commit -F message.txt", 'git commit -m "$MESSAGE"'])(
    "denies a git commit without a static message: %s",
    async (command) => {
      const cwd = await makeProject()
      const result = await runHook(event(cwd, "Bash", { command }), cwd)

      expect(result.code).toBe(0)
      const output = decision(result.output)
      expect(output.permissionDecision).toBe("deny")
      expect(output.permissionDecisionReason).toContain("static -m or --message argument")
    },
  )

  test("ignores a Bash event that does not contain a git commit", async () => {
    const cwd = await makeProject()
    const result = await runHook(event(cwd, "Bash", { command: "git status" }), cwd)

    expect(result.code).toBe(0)
    expect(decision(result.output)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    })
  })

  test("allows soft violations and returns warning text", async () => {
    const cwd = await makeProject({ rules: { "dictionary-not-approved-word": "off" } })
    const result = await runHook(
      event(cwd, "Write", {
        file_path: join(cwd, "notes.md"),
        content: "It is important to note that the valve is open.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("allow")
    expect(output.additionalContext).toContain("Writing-rule warning")
    expect(output.additionalContext).toContain("line 1, column 1 [hedging]")
    expect(output.additionalContext).toContain("Suggested fix:")
  })

  test("allows a clean Write event", async () => {
    const cwd = await makeProject()
    const result = await runHook(
      event(cwd, "Write", {
        file_path: join(cwd, "notes.md"),
        content: "Close the valve.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    expect(decision(result.output)).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    })
  })

  test("allows a valid event with a warning when configuration load fails", async () => {
    const cwd = await makeProject()
    const configPath = join(cwd, ".simple-english.json")
    await writeFile(configPath, "{")

    const result = await runHook(
      event(cwd, "Write", {
        file_path: join(cwd, "notes.md"),
        content: "This isn't permitted.",
      }),
      cwd,
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("allow")
    expect(output.additionalContext).toContain("Writing-rule hook warning")
    expect(output.additionalContext).toContain(`invalid JSON in ${configPath}`)
    expect(result.output.continue).toBeUndefined()
  })

  test("allows a valid event with a warning when tagger setup fails", async () => {
    const cwd = await makeProject()
    const result = await runHook(
      event(cwd, "Write", {
        file_path: join(cwd, "notes.md"),
        content: "This isn't permitted.",
      }),
      cwd,
      join(repoRoot, "test", "fixtures", "failing-tagger-preload.js"),
    )

    expect(result.code).toBe(0)
    const output = decision(result.output)
    expect(output.permissionDecision).toBe("allow")
    expect(output.additionalContext).toContain("Writing-rule hook warning")
    expect(output.additionalContext).toContain("forced tagger setup failure")
  })

  test("returns a non-blocking JSON error for malformed event JSON", async () => {
    const result = await runHook("{")

    expect(result.code).toBe(0)
    expect(result.output.continue).toBe(true)
    expect(result.output.systemMessage).toContain("Writing-rule hook error")
    expect(result.output.hookSpecificOutput).toBeUndefined()
  })
})
