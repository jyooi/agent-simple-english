import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import simpleEnglishExtension from "../../src/extension/index.ts"

const mkdirControl = vi.hoisted(() => ({
  afterMkdir: undefined as (() => Promise<void>) | undefined,
}))

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      const result = await actual.mkdir(...args)
      await mkdirControl.afterMkdir?.()
      return result
    },
  }
})

type EventHandler = (event: Record<string, unknown>, context: ExtensionContextStub) => unknown

type ToolHandler = {
  readonly name: string
  execute(
    toolCallId: string,
    input: never,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: ExtensionContextStub,
  ): unknown
}

interface ExtensionContextStub {
  readonly cwd: string
  readonly hasUI: boolean
  readonly ui: {
    notify(message: string, level: "info" | "warning" | "error"): void
  }
  isProjectTrusted(): boolean
}

class ExtensionApiStub {
  readonly handlers = new Map<string, EventHandler[]>()
  readonly tools = new Map<string, ToolHandler>()

  on(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(handler)
    this.handlers.set(event, handlers)
  }

  registerTool(tool: ToolHandler): void {
    this.tools.set(tool.name, tool)
  }

  async emit(event: string, payload: Record<string, unknown>, context: ExtensionContextStub) {
    const handlers = this.handlers.get(event)
    if (handlers === undefined) throw new Error(`No handler registered for ${event}`)
    let result: unknown
    for (const handler of handlers) {
      const next = await handler(payload, context)
      if (next !== undefined) result = next
      if (
        event === "tool_call" &&
        typeof next === "object" &&
        next !== null &&
        "block" in next &&
        next.block === true
      ) {
        return next
      }
    }
    return result
  }

  async executeTool(
    toolName: string,
    toolCallId: string,
    input: Record<string, unknown>,
    context: ExtensionContextStub,
    signal?: AbortSignal,
  ) {
    const gate = await this.emit("tool_call", { toolName, toolCallId, input }, context)
    if (typeof gate === "object" && gate !== null && "block" in gate && gate.block === true) {
      throw new Error("reason" in gate ? String(gate.reason) : "Tool call blocked")
    }
    const tool = this.tools.get(toolName)
    if (tool === undefined) throw new Error(`No tool registered for ${toolName}`)
    return tool.execute(toolCallId, input as never, signal, undefined, context)
  }
}

const temporaryDirectories: string[] = []
const originalAgentDirectory = process.env.PI_CODING_AGENT_DIR
const originalHome = process.env.HOME

afterEach(async () => {
  mkdirControl.afterMkdir = undefined
  if (originalAgentDirectory === undefined) process.env.PI_CODING_AGENT_DIR = undefined
  else process.env.PI_CODING_AGENT_DIR = originalAgentDirectory
  if (originalHome === undefined) process.env.HOME = undefined
  else process.env.HOME = originalHome
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function startExtension(options?: {
  readonly globalConfig?: object
  readonly projectConfig?: object
  readonly trusted?: boolean
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
    isProjectTrusted: () => options?.trusted ?? true,
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
    const { cwd, pi, context } = await startExtension()

    const blocked = await pi
      .executeTool(
        "write",
        "write-1",
        { path: "notes.md", content: "This isn't permitted." },
        context,
      )
      .then(
        () => undefined,
        (error: Error) => error,
      )

    expect(blocked).toBeInstanceOf(Error)
    expect(blocked?.message).toContain("line 1, column 6")
    expect(blocked?.message).toContain("[contraction]")
    expect(blocked?.message).toContain("Suggested fix:")

    await pi.executeTool(
      "write",
      "write-2",
      { path: "notes.md", content: "This is permitted." },
      context,
    )

    expect(await readFile(join(cwd, "notes.md"), "utf8")).toBe("This is permitted.")
  })

  test("does not write when cancellation occurs during directory creation", async () => {
    const { cwd, pi, context } = await startExtension()
    const controller = new AbortController()
    let notifyMkdirStarted: () => void = () => undefined
    let releaseMkdir: () => void = () => undefined
    const mkdirStarted = new Promise<void>((resolve) => {
      notifyMkdirStarted = resolve
    })
    const mkdirReleased = new Promise<void>((resolve) => {
      releaseMkdir = resolve
    })
    mkdirControl.afterMkdir = async () => {
      notifyMkdirStarted()
      await mkdirReleased
    }

    const execution = pi.executeTool(
      "write",
      "write-aborted",
      { path: "nested/notes.md", content: "This is permitted." },
      context,
      controller.signal,
    )
    await mkdirStarted
    controller.abort()
    releaseMkdir()

    await expect(execution).rejects.toThrow("Operation aborted")
    await expect(readFile(join(cwd, "nested/notes.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  test("gates write input after later tool-call handlers mutate it", async () => {
    const { cwd, pi, context } = await startExtension()
    pi.on("tool_call", (event) => {
      if (event.toolName !== "write") return undefined
      const input = event.input as Record<string, unknown>
      input.path = "notes.md"
      input.content = "This isn't permitted."
      return undefined
    })

    await expect(
      pi.executeTool(
        "write",
        "write-mutated",
        { path: "source.ts", content: `const message = "This isn't prose."` },
        context,
      ),
    ).rejects.toThrow("[contraction]")
    await expect(readFile(join(cwd, "notes.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("uses the file extension to lint only prose comments in source files", async () => {
    const { pi, context } = await startExtension()

    await expect(
      pi.executeTool(
        "write",
        "write-source-1",
        { path: "source.ts", content: `const message = "This isn't prose."` },
        context,
      ),
    ).resolves.toBeDefined()
    await expect(
      pi.executeTool(
        "write",
        "write-source-2",
        { path: "source.ts", content: "// This isn't permitted." },
        context,
      ),
    ).rejects.toThrow("[contraction]")
  })

  test("lints edits against the previous file and ignores unchanged violations", async () => {
    const { cwd, pi, context } = await startExtension()
    const path = join(cwd, "notes.md")
    await writeFile(path, "This isn't compliant.\nReplace this sentence.")

    await pi.executeTool(
      "edit",
      "edit-1",
      {
        path: "notes.md",
        edits: [{ oldText: "Replace this sentence.", newText: "Keep this sentence." }],
      },
      context,
    )

    await expect(
      pi.executeTool(
        "edit",
        "edit-2",
        {
          path: "notes.md",
          edits: [{ oldText: "Keep this sentence.", newText: "This isn't acceptable." }],
        },
        context,
      ),
    ).rejects.toThrow("line 2, column 6")
    expect(await readFile(path, "utf8")).toBe("This isn't compliant.\nKeep this sentence.")
  })

  test("uses pi edit path and text normalization and fails closed", async () => {
    const { cwd, pi, context } = await startExtension()
    process.env.HOME = cwd
    const path = join(cwd, "home-notes.md")
    const original = "\uFEFFKeep this line.\r\nReplace this line.\r\nKeep the final line.\r\n"
    await writeFile(path, original)

    await expect(
      pi.executeTool(
        "edit",
        "edit-normalized",
        {
          path: "~/home-notes.md",
          edits: [
            {
              oldText: "Replace this line.\nKeep the final line.",
              newText: "This isn't permitted.\nKeep the final line.",
            },
          ],
        },
        context,
      ),
    ).rejects.toThrow("[contraction]")
    expect(await readFile(path, "utf8")).toBe(original)

    await expect(
      pi.executeTool(
        "edit",
        "edit-invalid",
        {
          path: "@~/home-notes.md",
          edits: [{ oldText: "Missing text.", newText: "This isn't permitted." }],
        },
        context,
      ),
    ).rejects.toThrow("Could not find")
    expect(await readFile(path, "utf8")).toBe(original)
  })

  test("serializes parallel edits before linting the projected file", async () => {
    const { cwd, pi, context } = await startExtension({
      projectConfig: {
        maxSentenceWords: 6,
        rules: { "dictionary-not-approved-word": "off" },
      },
    })
    const path = join(cwd, "notes.md")
    await writeFile(path, "Open the access panel now.")

    const results = await Promise.allSettled([
      pi.executeTool(
        "edit",
        "edit-parallel-1",
        {
          path: "notes.md",
          edits: [{ oldText: "Open the", newText: "Open the small" }],
        },
        context,
      ),
      pi.executeTool(
        "edit",
        "edit-parallel-2",
        {
          path: "notes.md",
          edits: [{ oldText: "access panel", newText: "front access panel" }],
        },
        context,
      ),
    ])

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"])
    expect(results[1]).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("[sentence-length]") }),
    })
    expect(await readFile(path, "utf8")).toBe("Open the small access panel now.")
  })

  test("passes soft violations and shows warning feedback", async () => {
    const { pi, context, notifications } = await startExtension()

    const result = await pi.executeTool(
      "write",
      "write-soft",
      { path: "notes.md", content: "It is important to note that the valve is open." },
      context,
    )

    expect(result).toBeDefined()
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

  test("ignores project rule settings until the project is trusted", async () => {
    const { pi, context } = await startExtension({
      globalConfig: { rules: { contraction: "hard" } },
      projectConfig: { rules: { contraction: "off" } },
      trusted: false,
    })

    await expect(
      pi.executeTool(
        "write",
        "write-untrusted-config",
        { path: "notes.md", content: "This isn't permitted." },
        context,
      ),
    ).rejects.toThrow("[contraction]")
  })

  test("uses project rule settings over global settings in the extension context", async () => {
    const { pi, context, notifications } = await startExtension({
      globalConfig: { rules: { contraction: "hard" } },
      projectConfig: { rules: { contraction: "soft" } },
    })

    const result = await pi.executeTool(
      "write",
      "write-config",
      { path: "notes.md", content: "This isn't blocked." },
      context,
    )

    expect(result).toBeDefined()
    expect(notifications).toContainEqual({
      level: "warning",
      message: expect.stringContaining("[contraction]"),
    })
  })
})
