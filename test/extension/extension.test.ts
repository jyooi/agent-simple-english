import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import simpleEnglishExtension from "../../src/extension/index.ts"

type EventHandler = (event: Record<string, unknown>, context: ExtensionContextStub) => unknown

interface ExtensionContextStub {
  readonly cwd: string
  readonly hasUI: boolean
  readonly ui: {
    notify(message: string, level: "info" | "warning" | "error"): void
  }
}

class ExtensionApiStub {
  readonly handlers = new Map<string, EventHandler>()

  on(event: string, handler: EventHandler): void {
    this.handlers.set(event, handler)
  }

  async emit(event: string, payload: Record<string, unknown>, context: ExtensionContextStub) {
    const handler = this.handlers.get(event)
    if (handler === undefined) throw new Error(`No handler registered for ${event}`)
    return handler(payload, context)
  }
}

const temporaryDirectories: string[] = []
const originalAgentDirectory = process.env.PI_CODING_AGENT_DIR

afterEach(async () => {
  if (originalAgentDirectory === undefined) process.env.PI_CODING_AGENT_DIR = undefined
  else process.env.PI_CODING_AGENT_DIR = originalAgentDirectory
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function startExtension(options?: {
  readonly globalConfig?: object
  readonly projectConfig?: object
}) {
  const cwd = await mkdtemp(join(process.cwd(), ".extension-test-"))
  temporaryDirectories.push(cwd)
  const globalDirectory = join(cwd, "global")
  await mkdir(globalDirectory)
  process.env.PI_CODING_AGENT_DIR = globalDirectory
  if (options?.globalConfig !== undefined) {
    await writeFile(
      join(globalDirectory, "simple-english.json"),
      JSON.stringify(options.globalConfig),
    )
  }
  if (options?.projectConfig !== undefined) {
    const projectDirectory = join(cwd, ".pi")
    await mkdir(projectDirectory)
    await writeFile(
      join(projectDirectory, "simple-english.json"),
      JSON.stringify(options.projectConfig),
    )
  }

  const notifications: Array<{ message: string; level: string }> = []
  const context: ExtensionContextStub = {
    cwd,
    hasUI: true,
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
    },
  }
  const pi = new ExtensionApiStub()
  simpleEnglishExtension(pi as never)
  await pi.emit("session_start", { reason: "startup" }, context)
  return { cwd, pi, context, notifications }
}

describe.sequential("pi extension wiring", () => {
  test("declares a production pi extension package", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"))

    expect(manifest.pi.extensions).toEqual(["./src/extension/index.ts"])
    expect(manifest.dependencies).toMatchObject({
      effect: expect.any(String),
      "wink-eng-lite-web-model": expect.any(String),
      "wink-nlp": expect.any(String),
    })
    expect(manifest.peerDependencies).toMatchObject({
      "@earendil-works/pi-coding-agent": "*",
    })
  })

  test("injects an STE rule summary into the system prompt", async () => {
    const { pi, context } = await startExtension()

    const result = await pi.emit(
      "before_agent_start",
      { systemPrompt: "Base system prompt." },
      context,
    )

    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining("Simplified Technical English"),
    })
    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining("Do not use contractions"),
    })
  })

  test("blocks a hard write with location, rule, and fix feedback, then permits a clean write", async () => {
    const { pi, context } = await startExtension()

    const blocked = await pi.emit(
      "tool_call",
      {
        toolName: "write",
        toolCallId: "write-1",
        input: { path: "notes.md", content: "This isn't permitted." },
      },
      context,
    )

    expect(blocked).toMatchObject({ block: true })
    expect(blocked).toMatchObject({ reason: expect.stringContaining("line 1, column 6") })
    expect(blocked).toMatchObject({ reason: expect.stringContaining("[contraction]") })
    expect(blocked).toMatchObject({ reason: expect.stringContaining("Suggested fix:") })

    const permitted = await pi.emit(
      "tool_call",
      {
        toolName: "write",
        toolCallId: "write-2",
        input: { path: "notes.md", content: "This is permitted." },
      },
      context,
    )

    expect(permitted).toBeUndefined()
  })

  test("uses the file extension to lint only prose comments in source files", async () => {
    const { pi, context } = await startExtension()

    const stringLiteral = await pi.emit(
      "tool_call",
      {
        toolName: "write",
        toolCallId: "write-source-1",
        input: { path: "source.ts", content: `const message = "This isn't prose."` },
      },
      context,
    )
    const comment = await pi.emit(
      "tool_call",
      {
        toolName: "write",
        toolCallId: "write-source-2",
        input: { path: "source.ts", content: "// This isn't permitted." },
      },
      context,
    )

    expect(stringLiteral).toBeUndefined()
    expect(comment).toMatchObject({ block: true })
  })

  test("lints edits against the previous file and ignores unchanged violations", async () => {
    const { cwd, pi, context } = await startExtension()
    await writeFile(join(cwd, "notes.md"), "This isn't compliant.\nReplace this sentence.")

    const unchangedViolation = await pi.emit(
      "tool_call",
      {
        toolName: "edit",
        toolCallId: "edit-1",
        input: {
          path: "notes.md",
          edits: [{ oldText: "Replace this sentence.", newText: "Keep this sentence." }],
        },
      },
      context,
    )
    const changedViolation = await pi.emit(
      "tool_call",
      {
        toolName: "edit",
        toolCallId: "edit-2",
        input: {
          path: "notes.md",
          edits: [{ oldText: "Replace this sentence.", newText: "This isn't acceptable." }],
        },
      },
      context,
    )

    expect(unchangedViolation).toBeUndefined()
    expect(changedViolation).toMatchObject({ block: true })
    expect(changedViolation).toMatchObject({ reason: expect.stringContaining("line 2, column 6") })
  })

  test("passes soft violations and shows warning feedback", async () => {
    const { pi, context, notifications } = await startExtension()

    const result = await pi.emit(
      "tool_call",
      {
        toolName: "write",
        toolCallId: "write-soft",
        input: { path: "notes.md", content: "It is important to note that the valve is open." },
      },
      context,
    )

    expect(result).toBeUndefined()
    expect(notifications).toContainEqual({
      level: "warning",
      message: expect.stringContaining("[hedging]"),
    })

    const toolResult = await pi.emit(
      "tool_result",
      {
        toolName: "write",
        toolCallId: "write-soft",
        input: { path: "notes.md", content: "It is important to note that the valve is open." },
        content: [{ type: "text", text: "Wrote notes.md" }],
        details: undefined,
        isError: false,
      },
      context,
    )
    expect(toolResult).toMatchObject({
      content: [
        { type: "text", text: "Wrote notes.md" },
        { type: "text", text: expect.stringContaining("STE warnings for notes.md") },
      ],
    })
  })

  test("uses project rule settings over global settings in the extension context", async () => {
    const { pi, context, notifications } = await startExtension({
      globalConfig: { rules: { contraction: "hard" } },
      projectConfig: { rules: { contraction: "soft" } },
    })

    const result = await pi.emit(
      "tool_call",
      {
        toolName: "write",
        toolCallId: "write-config",
        input: { path: "notes.md", content: "This isn't blocked." },
      },
      context,
    )

    expect(result).toBeUndefined()
    expect(notifications).toContainEqual({
      level: "warning",
      message: expect.stringContaining("[contraction]"),
    })
  })
})
