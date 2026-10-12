import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
  blockHeldReply,
  holdReply,
  REPLY_HOLD_NOTICE,
  restoreReply,
  sessionStatePath,
} from "../../hooks/reply-hold.ts"
import { runCli } from "../cli/run-cli.ts"

type Piece = Readonly<Record<string, unknown>> & { readonly kind: string }

interface StepResult {
  readonly answer: string
  readonly toolUses: readonly { readonly name: string; readonly input: unknown }[]
  readonly stopReason: string | null
  readonly usage: unknown
}

interface ProcessRun {
  readonly argv: readonly string[]
  readonly cwd?: string
  readonly stdin?: string
}

type CheckOutcome = { exitCode: number; stdout: string; stderr: string } | Error

const temporaryDirectories: string[] = []
let turnNumber = 0

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

const clean: CheckOutcome = { exitCode: 0, stdout: "{}\n", stderr: "" }

const hard = (feedback: string): CheckOutcome => ({
  exitCode: 0,
  stdout: `${JSON.stringify({ feedback })}\n`,
  stderr: "",
})

const textReply = (answer: string): { pieces: Piece[]; result: StepResult } => ({
  pieces: [
    { kind: "engine", ref: 1 },
    { kind: "text", index: 0, ref: 2, text: answer.slice(0, 4) },
    { kind: "text", index: 0, ref: 3, text: answer.slice(4) },
    { kind: "stop", ref: 4, stopReason: "end_turn", usage: null },
  ],
  result: { answer, toolUses: [], stopReason: "end_turn", usage: null },
})

function session(options: { strict?: boolean; state?: string; checks?: CheckOutcome[] } = {}) {
  const events: string[] = []
  const logs: string[] = []
  const reads: string[] = []
  const runs: ProcessRun[] = []
  const signal = { aborted: false }
  const checks = [...(options.checks ?? [])]
  const state =
    options.state ?? JSON.stringify({ version: 3, enabled: true, strict: options.strict === true })
  const $ = {
    env: {
      get: async (name: string) => (name === "XDG_STATE_HOME" ? "/state" : undefined),
    },
    fs: {
      read: async (path: string) => {
        reads.push(path)
        return state
      },
    },
    session: { id: async () => "session-1", cwd: async () => "/project" },
    process: {
      run: async (argv: readonly string[], init?: { cwd?: string; stdin?: string }) => {
        events.push("check")
        runs.push({ argv, ...init })
        const outcome = checks.shift() ?? clean
        if (outcome instanceof Error) throw outcome
        return outcome
      },
    },
    plugin: { root: "/plugin" },
    ui: { log: (text: string) => void logs.push(text) },
  }
  const stream = (pieces: readonly Piece[], result: StepResult, called = false) => {
    const next = Object.assign(
      async function* () {
        for (const [index, piece] of pieces.entries()) {
          events.push(`produce:${index}`)
          yield piece
        }
        return result
      },
      { signal, called },
    )
    return next
  }
  async function show(
    hook: AsyncGenerator<Piece, StepResult>,
  ): Promise<{ shown: Piece[]; result: StepResult }> {
    const shown: Piece[] = []
    let item = await hook.next()
    while (item.done !== true) {
      events.push(`show:${shown.length}`)
      shown.push(item.value)
      item = await hook.next()
    }
    return { shown, result: item.value }
  }
  return { $, events, logs, reads, runs, signal, stream, show }
}

const newTurn = (agentId?: string) => {
  turnNumber += 1
  return { turnId: `turn-${turnNumber}`, index: 0, ...(agentId === undefined ? {} : { agentId }) }
}

const stopEvent = { hook_event_name: "Stop", stop_hook_active: false }

describe("Claude Code strict reply hold", () => {
  test("passes the stream on piece by piece when the session is not strict", async () => {
    const { $, events, runs, stream, show } = session({ strict: false })
    const { pieces, result } = textReply("This isn't permitted.")

    const output = await show(holdReply($, newTurn(), stream(pieces, result)))

    expect(output).toEqual({ shown: pieces, result })
    expect(events.slice(0, 4)).toEqual(["produce:0", "show:0", "produce:1", "show:1"])
    expect(runs).toEqual([])
  })

  test("passes the stream on when the session state has no valid content", async () => {
    const { $, runs, stream, show } = session({ state: "{" })
    const { pieces, result } = textReply("This isn't permitted.")

    await expect(show(holdReply($, newTurn(), stream(pieces, result)))).resolves.toEqual({
      shown: pieces,
      result,
    })
    expect(runs).toEqual([])
  })

  test("passes a subagent step on and does not read the session state", async () => {
    const { $, events, reads, runs, stream, show } = session({ strict: true })
    const { pieces, result } = textReply("This isn't permitted.")

    const output = await show(holdReply($, newTurn("agent-1"), stream(pieces, result)))

    expect(output).toEqual({ shown: pieces, result })
    expect(events.slice(0, 2)).toEqual(["produce:0", "show:0"])
    expect(reads).toEqual([])
    expect(runs).toEqual([])
  })

  test("holds each piece of a strict reply until the check gives no feedback", async () => {
    const { $, events, reads, runs, stream, show } = session({ strict: true, checks: [clean] })
    const { pieces, result } = textReply("Close the valve.")

    const output = await show(holdReply($, newTurn(), stream(pieces, result)))

    expect(output).toEqual({ shown: pieces, result })
    expect(events).toEqual([
      "produce:0",
      "produce:1",
      "produce:2",
      "produce:3",
      "check",
      "show:0",
      "show:1",
      "show:2",
      "show:3",
    ])
    expect(reads).toEqual([await sessionStatePath("session-1", "/state", undefined)])
    expect(runs).toEqual([
      {
        argv: ["bun", "src/cli/main.ts", "reply-check"],
        cwd: "/plugin",
        stdin: JSON.stringify({ session_id: "session-1", cwd: "/project", text: result.answer }),
      },
    ])
  })

  test("shows a notice for a reply with hard violations and blocks the Stop event", async () => {
    const { $, stream, show } = session({ strict: true, checks: [hard("- line 1: contraction")] })
    const { pieces, result } = textReply("This isn't permitted.")

    const output = await show(holdReply($, newTurn(), stream(pieces, result)))
    let lowerHooks = 0
    const lower = async () => {
      lowerHooks += 1
      return { additionalContext: ["x"] }
    }
    const blocked = await blockHeldReply($, stopEvent, lower)
    const second = await blockHeldReply($, stopEvent, lower)

    expect(output.result).toEqual(result)
    expect(output.shown).toEqual([
      { kind: "engine", ref: 1 },
      { kind: "text", index: 0, ref: 2, text: REPLY_HOLD_NOTICE },
      { kind: "stop", ref: 4, stopReason: "end_turn", usage: null },
    ])
    expect(blocked).toEqual({
      block: [
        "The writing rules held the reply text below. The user did not see it.",
        "<held-reply>\nThis isn't permitted.\n</held-reply>\n\n- line 1: contraction",
        "Write the full reply again. Correct each violation. Do not mention this message.",
      ].join("\n\n"),
    })
    expect(lowerHooks).toBe(1)
    expect(second).toEqual({ additionalContext: ["x"] })
  })

  test("runs the tool of a held step and blocks once for each held text of the turn", async () => {
    const { $, stream, show } = session({
      strict: true,
      checks: [hard("- first"), hard("- second")],
    })
    const turn = newTurn()
    const toolPieces: Piece[] = [
      { kind: "text", index: 0, ref: 1, text: "I'll run it." },
      { kind: "tool", index: 1, ref: 2, id: "toolu_1", name: "Bash" },
      { kind: "input", index: 1, ref: 3, json: '{"command":"true"}' },
      { kind: "stop", ref: 4, stopReason: "tool_use", usage: null },
    ]
    const toolResult: StepResult = {
      answer: "I'll run it.",
      toolUses: [{ name: "Bash", input: { command: "true" } }],
      stopReason: "tool_use",
      usage: null,
    }
    const last = textReply("It isn't ready.")

    const toolStep = await show(holdReply($, turn, stream(toolPieces, toolResult)))
    await show(holdReply($, { ...turn, index: 1 }, stream(last.pieces, last.result)))
    const blocked = await blockHeldReply($, stopEvent, async () => ({}))

    expect(toolStep.shown).toEqual([
      { kind: "text", index: 0, ref: 1, text: REPLY_HOLD_NOTICE },
      ...toolPieces.slice(1),
    ])
    expect(blocked.block).toContain("<held-reply>\nI'll run it.\n</held-reply>\n\n- first")
    expect(blocked.block).toContain("<held-reply>\nIt isn't ready.\n</held-reply>\n\n- second")
  })

  test("shows the third reply of a turn with no check after two blocks", async () => {
    const { $, events, runs, stream, show } = session({
      strict: true,
      checks: [hard("- first"), hard("- second")],
    })
    const turn = newTurn()
    const { pieces, result } = textReply("This isn't permitted.")

    await show(holdReply($, turn, stream(pieces, result)))
    await blockHeldReply($, stopEvent, async () => ({}))
    await show(holdReply($, { ...turn, index: 1 }, stream(pieces, result)))
    await blockHeldReply($, stopEvent, async () => ({}))
    events.length = 0
    const third = await show(holdReply($, { ...turn, index: 2 }, stream(pieces, result)))

    expect(third).toEqual({ shown: pieces, result })
    expect(events.slice(0, 2)).toEqual(["produce:0", "show:0"])
    expect(runs).toHaveLength(2)
    await expect(blockHeldReply($, stopEvent, async () => ({}))).resolves.toEqual({})
  })

  test("drops the held text of an earlier turn and starts a new block count", async () => {
    const { $, runs, stream, show } = session({
      strict: true,
      checks: [hard("- first"), hard("- second"), hard("- third"), clean],
    })
    const earlier = newTurn()
    const { pieces, result } = textReply("This isn't permitted.")

    await show(holdReply($, earlier, stream(pieces, result)))
    await blockHeldReply($, stopEvent, async () => ({}))
    await show(holdReply($, { ...earlier, index: 1 }, stream(pieces, result)))
    await blockHeldReply($, stopEvent, async () => ({}))
    const held = await show(holdReply($, newTurn(), stream(pieces, result)))
    const shown = await show(holdReply($, newTurn(), stream(pieces, result)))

    expect(held.shown).toHaveLength(3)
    expect(shown.shown).toHaveLength(4)
    expect(runs).toHaveLength(4)
    await expect(blockHeldReply($, stopEvent, async () => ({}))).resolves.toEqual({})
  })

  test("drops the held text of an interrupted turn when strict mode is off later", async () => {
    const strict = session({ strict: true, checks: [hard("- first")] })
    const plain = session({ strict: false })
    const { pieces, result } = textReply("This isn't permitted.")

    await strict.show(holdReply(strict.$, newTurn(), strict.stream(pieces, result)))
    await plain.show(holdReply(plain.$, newTurn(), plain.stream(pieces, result)))

    await expect(blockHeldReply(plain.$, stopEvent, async () => ({}))).resolves.toEqual({})
  })

  test("shows a step with no text and does not run the check", async () => {
    const { $, runs, stream, show } = session({ strict: true })
    const pieces: Piece[] = [
      { kind: "tool", index: 0, ref: 1, id: "toolu_1", name: "Bash" },
      { kind: "input", index: 0, ref: 2, json: "{}" },
    ]
    const result: StepResult = {
      answer: "",
      toolUses: [{ name: "Bash", input: {} }],
      stopReason: "tool_use",
      usage: null,
    }

    await expect(show(holdReply($, newTurn(), stream(pieces, result)))).resolves.toEqual({
      shown: pieces,
      result,
    })
    expect(runs).toEqual([])
  })

  test("shows the reply and logs a warning when the check fails", async () => {
    const failures: CheckOutcome[] = [
      { exitCode: 2, stdout: "", stderr: "cannot read config\n" },
      { exitCode: 0, stdout: "not JSON", stderr: "" },
      new Error("bun was not found"),
    ]
    for (const failure of failures) {
      const { $, logs, stream, show } = session({ strict: true, checks: [failure] })
      const { pieces, result } = textReply("This isn't permitted.")

      const output = await show(holdReply($, newTurn(), stream(pieces, result)))

      expect(output).toEqual({ shown: pieces, result })
      expect(logs).toEqual([
        expect.stringMatching(/^Writing-rule reply check error: .+\. The reply is allowed\.$/u),
      ])
      await expect(blockHeldReply($, stopEvent, async () => ({}))).resolves.toEqual({})
    }
  })

  test("names the cause in the warning", async () => {
    const { $, logs, stream, show } = session({
      strict: true,
      checks: [{ exitCode: 2, stdout: "", stderr: "cannot read config\n" }],
    })
    const { pieces, result } = textReply("Close the valve.")

    await show(holdReply($, newTurn(), stream(pieces, result)))

    expect(logs).toEqual([
      "Writing-rule reply check error: cannot read config. The reply is allowed.",
    ])
  })

  test("shows nothing after an interrupt during the read", async () => {
    const { $, runs, signal, stream, show } = session({ strict: true })
    const { pieces, result } = textReply("This isn't permitted.")
    signal.aborted = true

    const output = await show(holdReply($, newTurn(), stream(pieces.slice(0, 2), result)))

    expect(output).toEqual({ shown: [], result })
    expect(runs).toEqual([])
  })

  test("shows nothing after an interrupt during the check", async () => {
    const interrupted = session({ strict: true })
    const { pieces, result } = textReply("This isn't permitted.")
    interrupted.$.process.run = async () => {
      interrupted.signal.aborted = true
      throw new Error("$.process.run(bun) aborted")
    }

    const output = await interrupted.show(
      holdReply(interrupted.$, newTurn(), interrupted.stream(pieces, result)),
    )

    expect(output).toEqual({ shown: [], result })
    expect(interrupted.logs).toEqual([])
    await expect(blockHeldReply(interrupted.$, stopEvent, async () => ({}))).resolves.toEqual({})
  })

  test("the error handler passes the stream on when the hook did not call next", async () => {
    const { $, events, stream, show } = session({ strict: true })
    const { pieces, result } = textReply("Close the valve.")

    const output = await show(restoreReply($, newTurn(), stream(pieces, result, false)))

    expect(output).toEqual({ shown: pieces, result })
    expect(events.slice(0, 2)).toEqual(["produce:0", "show:0"])
  })

  test("the error handler makes the reply again from the result of the hook", async () => {
    const { $, stream, show } = session({ strict: true })
    const result: StepResult = {
      answer: "I will run the command.",
      toolUses: [
        { name: "Bash", input: { command: "true" } },
        { name: "Read", input: { file_path: "a.md" } },
      ],
      stopReason: "tool_use",
      usage: { input_tokens: 2 },
    }

    const turn = { ...newTurn(), index: 3 }
    const output = await show(restoreReply($, turn, stream([], result, true)))

    expect(output).toEqual({
      shown: [
        { kind: "text", index: 0, text: "I will run the command." },
        { kind: "tool", index: 1, id: `toolu_hold_${turn.turnId}_3_1`, name: "Bash" },
        { kind: "input", index: 1, json: '{"command":"true"}' },
        { kind: "tool", index: 2, id: `toolu_hold_${turn.turnId}_3_2`, name: "Read" },
        { kind: "input", index: 2, json: '{"file_path":"a.md"}' },
        { kind: "stop", stopReason: "tool_use", usage: { input_tokens: 2 } },
      ],
      result,
    })
  })

  test("the error handler shows nothing after an interrupt", async () => {
    const { $, signal, stream, show } = session({ strict: true })
    const { result } = textReply("Close the valve.")
    signal.aborted = true

    await expect(show(restoreReply($, newTurn(), stream([], result, true)))).resolves.toEqual({
      shown: [],
      result,
    })
  })

  test("reads the strict flag from the state file that the session command writes", async () => {
    const xdgStateHome = await mkdtemp(join(tmpdir(), "ste-hold-state-"))
    const home = await mkdtemp(join(tmpdir(), "ste-hold-home-"))
    temporaryDirectories.push(xdgStateHome, home)

    await runCli(["session", "hold-session", home, "strict"], { xdgStateHome })
    await runCli(["session", "home-session", home, "strict"], {
      home,
      xdgStateHome: "relative-state",
    })

    await expect(
      access(await sessionStatePath("hold-session", xdgStateHome, home)),
    ).resolves.toBeUndefined()
    await expect(
      access(await sessionStatePath("home-session", "relative-state", home)),
    ).resolves.toBeUndefined()
    await expect(
      access(await sessionStatePath("home-session", undefined, home)),
    ).resolves.toBeUndefined()
  })
})
