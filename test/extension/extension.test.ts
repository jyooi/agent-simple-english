import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ExtensionRunner, createExtensionRuntime } from "@earendil-works/pi-coding-agent"
import { afterEach, describe, expect, test, vi } from "vitest"
import simpleEnglishExtension from "../../src/extension/index.ts"

const mkdirControl = vi.hoisted(() => ({
  afterMkdir: undefined as (() => Promise<void>) | undefined,
}))
const bashControl = vi.hoisted(() => ({ executedCommands: [] as string[] }))

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()
  return {
    ...actual,
    createBashToolDefinition: (
      cwd: Parameters<typeof actual.createBashToolDefinition>[0],
      options?: Parameters<typeof actual.createBashToolDefinition>[1],
    ) =>
      actual.createBashToolDefinition(cwd, {
        ...options,
        exposeSessionEnvironment: false,
        operations: {
          exec: async (command: string) => {
            bashControl.executedCommands.push(command)
            return { exitCode: 0 }
          },
        },
      }),
  }
})

vi.mock("../../src/tagger/wink.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tagger/wink.ts")>()
  return { ...actual, makeWinkTagger: () => () => [] }
})

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

type CommandHandler = {
  readonly description: string
  handler(args: string, context: ExtensionContextStub): unknown
}

interface CommitCommandFixture {
  readonly name: string
  readonly command: string
}

type CommitHeuristicFixture = CommitCommandFixture &
  (
    | { readonly expected: "pass" | "explicit-message" }
    | { readonly expected: "contraction"; readonly location: string }
  )

interface ExtensionContextStub {
  readonly cwd: string
  readonly hasUI: boolean
  readonly sessionManager: {
    getBranch(): readonly Record<string, unknown>[]
  }
  readonly ui: {
    notify(message: string, level: "info" | "warning" | "error"): void
    setWidget(key: string, content: readonly string[] | undefined): void
  }
  isProjectTrusted(): boolean
}

class ExtensionApiStub {
  readonly activeTools = new Set<string>()
  readonly commands = new Map<string, CommandHandler>()
  readonly handlers = new Map<string, EventHandler[]>()
  readonly tools = new Map<string, ToolHandler>()

  on(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(handler)
    this.handlers.set(event, handlers)
  }

  registerTool(tool: ToolHandler): void {
    this.tools.set(tool.name, tool)
    this.activeTools.add(tool.name)
  }

  getActiveTools(): string[] {
    return [...this.activeTools]
  }

  setActiveTools(names: readonly string[]): void {
    this.activeTools.clear()
    for (const name of names) this.activeTools.add(name)
  }

  registerCommand(name: string, command: CommandHandler): void {
    this.commands.set(name, command)
  }

  async runCommand(name: string, args: string, context: ExtensionContextStub) {
    const command = this.commands.get(name)
    if (command === undefined) throw new Error(`No command registered for ${name}`)
    return command.handler(args, context)
  }

  async emit(event: string, payload: Record<string, unknown>, context: ExtensionContextStub) {
    const handlers = this.handlers.get(event) ?? []
    let currentPayload = payload
    let result: unknown
    for (const handler of handlers) {
      const next = await handler(currentPayload, context)
      if (next !== undefined) result = next
      if (
        event === "message_end" &&
        typeof next === "object" &&
        next !== null &&
        "message" in next
      ) {
        currentPayload = { ...payload, message: next.message }
      }
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

  async finalizeAssistant(
    message: ReturnType<typeof assistantMessage>,
    context: ExtensionContextStub,
  ) {
    const result = await this.emit("message_end", { message }, context)
    const finalized =
      typeof result === "object" && result !== null && "message" in result
        ? (result.message as ReturnType<typeof assistantMessage>)
        : message
    await this.emit("turn_end", { turnIndex: 0, message: finalized, toolResults: [] }, context)
    return finalized
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
    if (!this.activeTools.has(toolName)) throw new Error(`Tool is not active: ${toolName}`)
    return tool.execute(toolCallId, input as never, signal, undefined, context)
  }
}

const temporaryDirectories: string[] = []
const originalAgentDirectory = process.env.PI_CODING_AGENT_DIR
const originalDictionary = process.env.SIMPLE_ENGLISH_DICTIONARY
const originalHome = process.env.HOME

afterEach(async () => {
  mkdirControl.afterMkdir = undefined
  bashControl.executedCommands.length = 0
  if (originalAgentDirectory === undefined) process.env.PI_CODING_AGENT_DIR = undefined
  else process.env.PI_CODING_AGENT_DIR = originalAgentDirectory
  if (originalDictionary === undefined) {
    Reflect.deleteProperty(process.env, "SIMPLE_ENGLISH_DICTIONARY")
  } else {
    process.env.SIMPLE_ENGLISH_DICTIONARY = originalDictionary
  }
  if (originalHome === undefined) process.env.HOME = undefined
  else process.env.HOME = originalHome
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function startExtension(options?: {
  readonly branch?: readonly Record<string, unknown>[]
  readonly globalConfig?: object | string
  readonly projectConfig?: object
  readonly sessionStartReason?: "startup" | "resume"
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
      typeof options.globalConfig === "string"
        ? options.globalConfig
        : JSON.stringify(options.globalConfig),
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
  const widgets = new Map<string, readonly string[] | undefined>()
  let branch = options?.branch ?? []
  const context: ExtensionContextStub = {
    cwd,
    hasUI: true,
    sessionManager: {
      getBranch: () => branch,
    },
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      setWidget: (key, content) => widgets.set(key, content),
    },
    isProjectTrusted: () => options?.trusted ?? true,
  }
  const pi = new ExtensionApiStub()
  simpleEnglishExtension(pi as never)
  await pi.emit("session_start", { reason: options?.sessionStartReason ?? "startup" }, context)
  return {
    cwd,
    pi,
    context,
    notifications,
    setBranch: (nextBranch: readonly Record<string, unknown>[]) => {
      branch = nextBranch
    },
    widgets,
  }
}

function assistantMessage(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  }
}

function boundaryRunner(
  sessionManager: ExtensionContextStub["sessionManager"],
  handlers: Readonly<Record<string, readonly EventHandler[]>>,
): ExtensionRunner {
  const extension = {
    path: "later-extension",
    resolvedPath: "later-extension",
    sourceInfo: {},
    handlers: new Map(Object.entries(handlers)),
    tools: new Map(),
    messageRenderers: new Map(),
    entryRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  }
  return new ExtensionRunner(
    [extension] as never,
    createExtensionRuntime(),
    process.cwd(),
    sessionManager as never,
    {} as never,
  )
}

function assistantEntry(text: string, id = "assistant-reply") {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: assistantMessage(text),
  }
}

async function executeBash(
  pi: ExtensionApiStub,
  context: ExtensionContextStub,
  toolCallId: string,
  command: string,
): Promise<Error | undefined> {
  return pi.executeTool("bash", toolCallId, { command }, context).then(
    () => undefined,
    (error: Error) => error,
  )
}

function sayResultEntry(text: string, id = "say-result") {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "toolResult",
      toolCallId: "say-approved",
      toolName: "say",
      content: [{ type: "text", text }],
      details: {},
      isError: false,
      timestamp: Date.now(),
    },
  }
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
    expect(manifest.dependencies).not.toHaveProperty("typebox")
    expect(manifest.peerDependencies).toMatchObject({
      "@earendil-works/pi-coding-agent": "*",
      typebox: "*",
    })
    expect(manifest.devDependencies).toMatchObject({ typebox: "1.3.7" })
  })

  test("injects an STE rule summary that reflects merged active settings", async () => {
    const { pi, context } = await startExtension({
      globalConfig: {
        maxSentenceWords: 30,
        rules: { contraction: "hard", semicolon: "soft" },
      },
      projectConfig: {
        maxSentenceWords: 8,
        rules: { contraction: "off", semicolon: "hard" },
      },
    })

    const result = await pi.emit(
      "before_agent_start",
      { systemPrompt: "Base system prompt." },
      context,
    )

    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining("Simplified Technical English"),
    })
    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining("[hard] Do not use semicolons"),
    })
    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining("Keep each sentence to 8 words or fewer"),
    })
    expect(result).toMatchObject({
      systemPrompt: expect.not.stringContaining("Do not use contractions"),
    })
    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining("git commit messages reject hard violations"),
    })
  })

  test("blocks a hard commit message with structured feedback", async () => {
    const { pi, context } = await startExtension()

    const error = await executeBash(
      pi,
      context,
      "commit-blocked",
      `git commit -m "fix: This isn't permitted."`,
    )

    expect(error?.message).toContain("line 1, column 11")
    expect(error?.message).toContain("[contraction]")
    expect(error?.message).toContain("Suggested fix:")
    expect(bashControl.executedCommands).toHaveLength(0)
  })

  test("permits a clean commit message", async () => {
    const { pi, context } = await startExtension()

    await expect(
      executeBash(
        pi,
        context,
        "commit-clean",
        `git add notes.md && git commit -m "fix: Close the valve."`,
      ),
    ).resolves.toBeUndefined()
    expect(bashControl.executedCommands).toEqual([
      `git add notes.md && git commit -m "fix: Close the valve."`,
    ])
  })

  test("gates the bash command after later tool-call handlers mutate it", async () => {
    const { pi, context } = await startExtension()
    pi.on("tool_call", (event) => {
      if (event.toolName !== "bash") return undefined
      const input = event.input as Record<string, unknown>
      input.command = `git commit -m "fix: This isn't permitted."`
      return undefined
    })

    const error = await executeBash(pi, context, "commit-mutated", "printf 'safe'")

    expect(error?.message).toContain("[contraction]")
    expect(bashControl.executedCommands).toHaveLength(0)
  })

  test("exempts Conventional Commit prefixes and trailer lines from fixtures", async () => {
    const { pi, context } = await startExtension()
    const fixtures = JSON.parse(
      await readFile(join(process.cwd(), "test/fixtures/commit-commands.json"), "utf8"),
    ) as CommitCommandFixture[]

    for (const fixture of fixtures) {
      await expect(
        executeBash(pi, context, `commit-fixture-${fixture.name}`, fixture.command),
        fixture.name,
      ).resolves.toBeUndefined()
    }
  })

  test("pins bounded commit command detection heuristics in fixtures", async () => {
    const { pi, context } = await startExtension()
    const fixtures = JSON.parse(
      await readFile(join(process.cwd(), "test/fixtures/commit-command-heuristics.json"), "utf8"),
    ) as CommitHeuristicFixture[]

    for (const fixture of fixtures) {
      const error = await executeBash(
        pi,
        context,
        `commit-heuristic-${fixture.name}`,
        fixture.command,
      )
      if (fixture.expected === "pass") {
        expect(error, fixture.name).toBeUndefined()
      } else if (fixture.expected === "contraction") {
        expect(error?.message, fixture.name).toContain("[contraction]")
        expect(error?.message, fixture.name).toContain(fixture.location)
      } else {
        expect(error?.message, fixture.name).toContain("static -m or --message argument")
      }
    }
  })

  test("reports original positions in a multi-line commit subject and body", async () => {
    const { pi, context } = await startExtension()

    const error = await executeBash(
      pi,
      context,
      "commit-multiline",
      `git commit -m "fix: Close the valve." -m "This isn't permitted."`,
    )

    expect(error?.message).toContain("line 3, column 6")
    expect(error?.message).toContain("[contraction]")
  })

  test("toggles write, edit, commit, and reply enforcement for the session", async () => {
    const { cwd, pi, context, widgets } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })

    await expect(
      pi.executeTool(
        "write",
        "write-enabled",
        { path: "notes.md", content: "This isn't permitted." },
        context,
      ),
    ).rejects.toThrow("[contraction]")
    expect(
      (
        await executeBash(
          pi,
          context,
          "commit-enabled",
          `git commit -m "fix: This isn't permitted."`,
        )
      )?.message,
    ).toContain("[contraction]")

    await pi.runCommand("ste", "", context)

    await expect(
      pi.executeTool(
        "write",
        "write-disabled",
        { path: "notes.md", content: "This isn't permitted." },
        context,
      ),
    ).resolves.toBeDefined()
    await expect(
      pi.executeTool(
        "edit",
        "edit-disabled",
        {
          path: "notes.md",
          edits: [{ oldText: "This isn't permitted.", newText: "This can't be permitted." }],
        },
        context,
      ),
    ).resolves.toBeDefined()
    expect(await readFile(join(cwd, "notes.md"), "utf8")).toBe("This can't be permitted.")
    await expect(
      executeBash(pi, context, "commit-disabled", `git commit -m "fix: This isn't permitted."`),
    ).resolves.toBeUndefined()
    await pi.finalizeAssistant(assistantMessage("This isn't permitted."), context)
    expect(widgets.get("simple-english-reply")).toBeUndefined()
    await expect(pi.emit("context", { messages: [] }, context)).resolves.toBeUndefined()
    await expect(
      pi.emit("before_agent_start", { systemPrompt: "Base system prompt." }, context),
    ).resolves.toBeUndefined()

    await pi.runCommand("ste", "", context)

    await expect(
      pi.executeTool(
        "write",
        "write-reenabled",
        { path: "notes.md", content: "This isn't permitted." },
        context,
      ),
    ).rejects.toThrow("[contraction]")
    await expect(
      pi.executeTool(
        "edit",
        "edit-reenabled",
        {
          path: "notes.md",
          edits: [{ oldText: "This can't be permitted.", newText: "This won't be permitted." }],
        },
        context,
      ),
    ).rejects.toThrow("[contraction]")
    expect(await readFile(join(cwd, "notes.md"), "utf8")).toBe("This can't be permitted.")
    expect(
      (
        await executeBash(
          pi,
          context,
          "commit-reenabled",
          `git commit -m "fix: This isn't permitted."`,
        )
      )?.message,
    ).toContain("[contraction]")
    await pi.finalizeAssistant(assistantMessage("This isn't permitted."), context)
    expect(widgets.get("simple-english-reply")).toEqual(["STE reply: 1 hard, 0 soft"])
  })

  test("reports the mode, rule severity counts, and dictionary state", async () => {
    const { pi, context, notifications } = await startExtension({
      projectConfig: { rules: { contraction: "off", semicolon: "soft" } },
    })

    await pi.runCommand("ste", "status", context)

    expect(notifications.at(-1)).toEqual({
      level: "info",
      message: expect.stringContaining("Mode: enabled"),
    })
    expect(notifications.at(-1)?.message).toContain("Rules: 6 hard, 4 soft, 1 off")
    expect(notifications.at(-1)?.message).toContain("Dictionary: loaded")

    await pi.runCommand("ste", "off", context)
    await pi.runCommand("ste", "status", context)
    expect(notifications.at(-1)?.message).toContain("Mode: disabled")

    await pi.runCommand("ste", "strict", context)
    await pi.runCommand("ste", "status", context)
    expect(notifications.at(-1)?.message).toContain("Mode: strict")
  })

  test("reports the dictionary as not loaded when config loading fails", async () => {
    const { pi, context, notifications } = await startExtension({ globalConfig: "{" })

    await pi.runCommand("ste", "status", context)

    expect(notifications.at(-1)?.message).toContain("Mode: enabled")
    expect(notifications.at(-1)?.message).toContain("Dictionary: not loaded")
    expect(notifications.at(-1)?.message).not.toContain("Dictionary: failed")
  })

  test("reports a failed dictionary load", async () => {
    process.env.SIMPLE_ENGLISH_DICTIONARY = join(process.cwd(), "missing-dictionary.json")
    const { pi, context, notifications } = await startExtension()

    await pi.runCommand("ste", "status", context)

    expect(notifications.at(-1)?.message).toContain("Mode: enabled")
    expect(notifications.at(-1)?.message).toContain("Dictionary: failed (")
    expect(notifications.at(-1)?.message).toContain("missing-dictionary.json")
  })

  test("gates strict replies through say until a clean rewrite passes", async () => {
    const { pi, context } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })

    await pi.runCommand("ste", "strict", context)
    expect(pi.activeTools.has("say")).toBe(true)
    const prompt = await pi.emit(
      "before_agent_start",
      { systemPrompt: "Base system prompt." },
      context,
    )
    expect(prompt).toMatchObject({
      systemPrompt: expect.stringContaining("Send every user-facing reply through the `say` tool"),
    })

    await expect(
      pi.executeTool("say", "say-blocked", { text: "This isn't permitted." }, context),
    ).rejects.toThrow("line 1, column 6 [contraction]")

    await expect(
      pi.executeTool("say", "say-clean", { text: "Open the valve." }, context),
    ).resolves.toMatchObject({
      content: [{ type: "text", text: "Open the valve." }],
      terminate: true,
    })
  })

  test("suppresses ordinary assistant text throughout strict reply streaming", async () => {
    const { pi, context } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })
    await pi.runCommand("ste", "strict", context)

    const started = assistantMessage("This isn't permitted.")
    await pi.emit("message_start", { message: started }, context)
    expect(started.content).toEqual([])

    const partial = assistantMessage("This isn't permitted.")
    const update = {
      message: partial,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "This isn't permitted.",
        partial: assistantMessage("This isn't permitted."),
      },
    }
    await pi.emit("message_update", update, context)
    expect(partial.content).toEqual([])
    expect(update.assistantMessageEvent.delta).toBe("")
    expect(update.assistantMessageEvent.partial.content).toEqual([])

    const thinking = {
      ...assistantMessage(""),
      content: [{ type: "thinking", thinking: "This isn't permitted." }],
    }
    await pi.emit("message_start", { message: thinking }, context)
    expect(thinking.content).toEqual([])

    const thinkingPartial = {
      ...assistantMessage(""),
      content: [{ type: "thinking", thinking: "This isn't permitted." }],
    }
    const thinkingUpdate = {
      message: thinkingPartial,
      assistantMessageEvent: {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "This isn't permitted.",
        partial: {
          ...assistantMessage(""),
          content: [{ type: "thinking", thinking: "This isn't permitted." }],
        },
      },
    }
    await pi.emit("message_update", thinkingUpdate, context)
    expect(thinkingPartial.content).toEqual([])
    expect(thinkingUpdate.assistantMessageEvent.delta).toBe("")
    expect(thinkingUpdate.assistantMessageEvent.partial.content).toEqual([])

    const thinkingEnd = {
      message: {
        ...assistantMessage(""),
        content: [{ type: "thinking", thinking: "This isn't permitted." }],
      },
      assistantMessageEvent: {
        type: "thinking_end",
        contentIndex: 0,
        content: "This isn't permitted.",
        partial: {
          ...assistantMessage(""),
          content: [{ type: "thinking", thinking: "This isn't permitted." }],
        },
      },
    }
    await pi.emit("message_update", thinkingEnd, context)
    expect(thinkingEnd.assistantMessageEvent.content).toBe("")
    expect(thinkingEnd.assistantMessageEvent.partial.content).toEqual([])

    const finalized = await pi.finalizeAssistant(assistantMessage("This isn't permitted."), context)
    expect(finalized.content).toEqual([])
  })

  test("redacts strict say arguments until the gated result succeeds", async () => {
    const { pi, context } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })
    await pi.runCommand("ste", "strict", context)

    const message = {
      ...assistantMessage(""),
      content: [
        {
          type: "toolCall",
          id: "say-redacted",
          name: "say",
          arguments: { text: "Open the valve." },
        },
      ],
    }
    const update = {
      message,
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '"text":"Open the valve."',
        partial: message,
      },
    }

    await pi.emit("message_update", update, context)

    expect(update.assistantMessageEvent.delta).toBe("")
    expect(message.content[0]?.arguments).toEqual({
      text: "[redacted until STE approval]",
    })
    await expect(
      pi.executeTool("say", "say-redacted", { text: "[redacted until STE approval]" }, context),
    ).resolves.toMatchObject({ content: [{ type: "text", text: "Open the valve." }] })
  })

  test("enforces strict output after later extension middleware", async () => {
    const { pi, context } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })
    await pi.runCommand("ste", "strict", context)
    await pi.executeTool("say", "say-approved", { text: "Open the valve." }, context)

    const runner = boundaryRunner(context.sessionManager, {
      message_end: [
        () => ({
          message: {
            ...assistantMessage(""),
            content: [{ type: "thinking", thinking: "This isn't permitted." }],
          },
        }),
      ],
      message_update: [
        (event) => {
          const update = event.assistantMessageEvent as {
            delta: string
            partial: ReturnType<typeof assistantMessage>
          }
          update.delta = "This isn't permitted."
          update.partial = {
            ...assistantMessage(""),
            content: [{ type: "thinking", thinking: "This isn't permitted." }],
          } as never
        },
      ],
      tool_result: [() => ({ content: [{ type: "text", text: "This isn't permitted." }] })],
    })
    const streamedThinking = {
      type: "message_update",
      message: {
        ...assistantMessage(""),
        content: [{ type: "thinking", thinking: "Open the valve." }],
      },
      assistantMessageEvent: {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "Open the valve.",
        partial: {
          ...assistantMessage(""),
          content: [{ type: "thinking", thinking: "Open the valve." }],
        },
      },
    }
    await runner.emit(streamedThinking as never)

    const assistant = assistantMessage("Open the valve.")
    const finalized = await runner.emitMessageEnd({
      type: "message_end",
      message: assistant,
    } as never)
    const result = await runner.emitToolResult({
      type: "tool_result",
      toolName: "say",
      toolCallId: "say-approved",
      input: { text: "Open the valve." },
      content: [{ type: "text", text: "Open the valve." }],
      details: {},
      isError: false,
    })

    expect(streamedThinking.message.content).toEqual([])
    expect(streamedThinking.assistantMessageEvent.delta).toBe("")
    expect(streamedThinking.assistantMessageEvent.partial.content).toEqual([])
    expect(finalized).toMatchObject({ content: [] })
    expect(result).toMatchObject({
      content: [{ type: "text", text: "Open the valve." }],
      details: {},
      isError: false,
    })
  })

  test("gates strict say input after later tool-call handlers mutate it", async () => {
    const { pi, context } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })
    await pi.runCommand("ste", "strict", context)
    pi.on("tool_call", (event) => {
      if (event.toolName === "say") {
        const input = event.input as { text: string }
        input.text = "This isn't permitted."
      }
    })

    await expect(
      pi.executeTool("say", "say-mutated", { text: "Open the valve." }, context),
    ).rejects.toThrow("line 1, column 6 [contraction]")
  })

  test("turns strict mode off and restores normal assistant replies", async () => {
    const { pi, context, widgets } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })
    await pi.runCommand("ste", "strict", context)
    await pi.runCommand("ste", "strict off", context)
    expect(pi.activeTools.has("say")).toBe(false)

    const prompt = await pi.emit(
      "before_agent_start",
      { systemPrompt: "Base system prompt." },
      context,
    )
    expect(prompt).toMatchObject({
      systemPrompt: expect.stringContaining("Simplified Technical English"),
    })
    expect(prompt).toMatchObject({
      systemPrompt: expect.not.stringContaining(
        "Send every user-facing reply through the `say` tool",
      ),
    })

    const streamed = assistantMessage("This isn't permitted.")
    const update = {
      message: streamed,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "This isn't permitted.",
        partial: assistantMessage("This isn't permitted."),
      },
    }
    await pi.emit("message_update", update, context)
    expect(streamed.content).toEqual([{ type: "text", text: "This isn't permitted." }])
    expect(update.assistantMessageEvent.delta).toBe("This isn't permitted.")

    const reply = assistantMessage("This isn't permitted.")
    await expect(pi.finalizeAssistant(reply, context)).resolves.toBe(reply)
    expect(widgets.get("simple-english-reply")).toEqual(["STE reply: 1 hard, 0 soft"])
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

  test("shows reply counts and injects only hard feedback before the next model call", async () => {
    const { pi, context, widgets } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })
    const reply = assistantMessage(
      "This isn't permitted. It is important to note that the valve is open.",
    )

    const finalized = await pi.finalizeAssistant(reply, context)

    expect(finalized).toBe(reply)
    expect(widgets.get("simple-english-reply")).toEqual(["STE reply: 1 hard, 1 soft"])

    const result = await pi.emit(
      "context",
      { messages: [reply, { role: "user", content: "Continue.", timestamp: Date.now() }] },
      context,
    )
    expect(result).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "custom",
          customType: "simple-english-reply-feedback",
          content: expect.stringContaining("[contraction]"),
          display: false,
        }),
      ]),
    })
    expect(result).toMatchObject({
      messages: expect.not.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("[hedging]") }),
      ]),
    })
    await expect(pi.emit("context", { messages: [reply] }, context)).resolves.toBeUndefined()
  })

  test("restores reply feedback from the active branch on resume", async () => {
    const reply = assistantMessage("This isn't permitted.")
    const { pi, context, widgets } = await startExtension({
      branch: [assistantEntry("This isn't permitted.")],
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
      sessionStartReason: "resume",
    })

    expect(widgets.get("simple-english-reply")).toEqual(["STE reply: 1 hard, 0 soft"])
    const result = await pi.emit("context", { messages: [reply] }, context)
    expect(result).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          customType: "simple-english-reply-feedback",
          content: expect.stringContaining("[contraction]"),
        }),
      ]),
    })
  })

  test("restores the latest successful strict say reply", async () => {
    const { pi, context, widgets } = await startExtension({
      branch: [
        assistantEntry("This isn't permitted.", "old-reply"),
        sayResultEntry("Open the valve."),
      ],
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
      sessionStartReason: "resume",
    })

    expect(widgets.get("simple-english-reply")).toEqual(["STE reply: clean"])
    await expect(pi.emit("context", { messages: [] }, context)).resolves.toBeUndefined()
  })

  test("keeps reply checking cleared during disabled tree navigation", async () => {
    const { pi, context, setBranch, widgets } = await startExtension({
      branch: [assistantEntry("Open the valve.")],
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })
    await pi.runCommand("ste", "off", context)
    setBranch([assistantEntry("This isn't permitted.", "blocked-reply")])

    await pi.emit(
      "session_tree",
      { newLeafId: "blocked-reply", oldLeafId: "assistant-reply" },
      context,
    )
    await pi.runCommand("ste", "on", context)

    expect(widgets.get("simple-english-reply")).toBeUndefined()
    await expect(pi.emit("context", { messages: [] }, context)).resolves.toBeUndefined()
  })

  test("recomputes reply state after session tree navigation", async () => {
    const { pi, context, setBranch, widgets } = await startExtension({
      branch: [assistantEntry("This isn't permitted.")],
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })
    setBranch([assistantEntry("Open the valve.", "clean-reply")])

    await pi.emit(
      "session_tree",
      { newLeafId: "clean-reply", oldLeafId: "assistant-reply" },
      context,
    )

    expect(widgets.get("simple-english-reply")).toEqual(["STE reply: clean"])
    await expect(pi.emit("context", { messages: [] }, context)).resolves.toBeUndefined()
  })

  test("lints the finalized reply after message-end replacements", async () => {
    const { pi, context, widgets } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })
    pi.on("message_end", () => ({ message: assistantMessage("Open the valve.") }))

    const finalized = await pi.finalizeAssistant(assistantMessage("This isn't permitted."), context)

    expect(finalized.content).toEqual([{ type: "text", text: "Open the valve." }])
    expect(widgets.get("simple-english-reply")).toEqual(["STE reply: clean"])
    await expect(pi.emit("context", { messages: [] }, context)).resolves.toBeUndefined()
  })

  test("shows soft reply violations without injecting feedback", async () => {
    const { pi, context, widgets } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })

    await pi.finalizeAssistant(
      assistantMessage("It is important to note that the valve is open."),
      context,
    )

    expect(widgets.get("simple-english-reply")).toEqual(["STE reply: 0 hard, 1 soft"])
    await expect(pi.emit("context", { messages: [] }, context)).resolves.toBeUndefined()
  })

  test("shows a clean reply without injecting feedback", async () => {
    const { pi, context, widgets } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })

    await pi.finalizeAssistant(assistantMessage("Open the valve."), context)

    expect(widgets.get("simple-english-reply")).toEqual(["STE reply: clean"])
    await expect(pi.emit("context", { messages: [] }, context)).resolves.toBeUndefined()
  })

  test("excludes fenced code blocks from reply linting", async () => {
    const { pi, context, widgets } = await startExtension({
      projectConfig: { rules: { "dictionary-not-approved-word": "off" } },
    })
    const reply = ["```text", "This isn't permitted.", "```", "Open the valve."].join("\n")

    await pi.finalizeAssistant(assistantMessage(reply), context)

    expect(widgets.get("simple-english-reply")).toEqual(["STE reply: clean"])
    await expect(pi.emit("context", { messages: [] }, context)).resolves.toBeUndefined()
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
