import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { runCli } from "./run-cli.ts"

interface HookSpecificOutput {
  readonly hookEventName: string
  readonly permissionDecision: string
  readonly permissionDecisionReason?: string
  readonly additionalContext?: string
}

interface HookOutput {
  readonly continue?: boolean
  readonly systemMessage?: string
  readonly hookSpecificOutput?: HookSpecificOutput
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

function event(cwd: string, toolName: "Write" | "Edit" | "Bash", toolInput: object): string {
  return JSON.stringify({
    session_id: "session-1",
    transcript_path: join(cwd, "transcript.jsonl"),
    cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "tool-1",
  })
}

async function runHook(stdin: string, cwd?: string) {
  const result = await runCli(["hook"], { stdin, cwd })
  return { ...result, output: JSON.parse(result.stdout) as HookOutput }
}

function decision(output: HookOutput): HookSpecificOutput {
  expect(output.hookSpecificOutput).toBeDefined()
  return output.hookSpecificOutput as HookSpecificOutput
}

describe("simple-english CLI hook mode", () => {
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
    expect(output.additionalContext).toContain("STE warning")
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
    expect(output.additionalContext).toContain("STE hook warning")
    expect(output.additionalContext).toContain(`invalid JSON in ${configPath}`)
    expect(result.output.continue).toBeUndefined()
  })

  test("returns a non-blocking JSON error for malformed event JSON", async () => {
    const result = await runHook("{")

    expect(result.code).toBe(0)
    expect(result.output.continue).toBe(true)
    expect(result.output.systemMessage).toContain("STE hook error")
    expect(result.output.hookSpecificOutput).toBeUndefined()
  })
})
