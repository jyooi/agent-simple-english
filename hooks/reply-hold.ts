export const REPLY_HOLD_NOTICE = "The writing rules held this reply. A corrected reply follows."

const BLOCK_LIMIT = 2

type Piece = Readonly<Record<string, unknown>> & { readonly kind: string }

interface StepResult {
  readonly answer: string
  readonly toolUses: readonly { readonly name: string; readonly input: unknown }[]
  readonly stopReason: string | null
  readonly usage: unknown
}

interface StepEvent {
  readonly turnId: string
  readonly index: number
  readonly agentId?: string
}

interface StepNext {
  (e: StepEvent): AsyncGenerator<Piece, StepResult>
  readonly signal: { readonly aborted: boolean }
}

interface HoldApi {
  readonly env: { get(name: string): Promise<string | undefined> }
  readonly fs: { read(path: string): Promise<string> }
  readonly session: { id(): Promise<string>; cwd(): Promise<string> }
  readonly process: {
    run(
      argv: readonly string[],
      init?: { cwd?: string; stdin?: string },
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
  readonly plugin: { readonly root: string }
  readonly ui: { log(text: string): void }
}

interface HeldReply {
  readonly reply: string
  readonly feedback: string
}

type StopResult = Readonly<Record<string, unknown>>

interface StopEvent {
  readonly stop_hook_active?: unknown
}

let turn = {
  id: "",
  blocks: 0,
  held: [] as HeldReply[],
  blocked: [] as HeldReply[],
  noticeIsLast: false,
  uncheckedIsLast: false,
}

export async function sessionStatePath(
  sessionId: string,
  stateHome: string | undefined,
  home: string | undefined,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionId))
  const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
  const root = stateHome?.startsWith("/") ? stateHome : `${home}/.local/state`
  return `${root}/simple-english/sessions/${key.join("")}.json`
}

async function strictSession($: HoldApi): Promise<boolean> {
  try {
    const path = await sessionStatePath(
      await $.session.id(),
      await $.env.get("XDG_STATE_HOME"),
      await $.env.get("HOME"),
    )
    const state = JSON.parse(await $.fs.read(path)) as { enabled?: unknown; strict?: unknown }
    return state.enabled === true && state.strict === true
  } catch {
    return false
  }
}

async function replyFeedback($: HoldApi, text: string): Promise<string | undefined> {
  const check = await $.process.run(["bun", "src/cli/main.ts", "reply-check"], {
    cwd: $.plugin.root,
    stdin: JSON.stringify({ session_id: await $.session.id(), cwd: await $.session.cwd(), text }),
  })
  if (check.exitCode !== 0) throw new Error(check.stderr.trim() || `exit code ${check.exitCode}`)
  const feedback = (JSON.parse(check.stdout) as { feedback?: unknown }).feedback
  return typeof feedback === "string" ? feedback : undefined
}

async function readAll(
  stream: AsyncGenerator<Piece, StepResult>,
): Promise<{ pieces: Piece[]; result: StepResult }> {
  const pieces: Piece[] = []
  let item = await stream.next()
  while (item.done !== true) {
    pieces.push(item.value)
    item = await stream.next()
  }
  return { pieces, result: item.value }
}

function* noticePieces(pieces: readonly Piece[]): Generator<Piece> {
  let replaced = false
  for (const piece of pieces) {
    if (piece.kind !== "text") {
      yield piece
    } else if (!replaced) {
      replaced = true
      yield { ...piece, text: REPLY_HOLD_NOTICE }
    }
  }
}

const blockReason = (held: readonly HeldReply[]): string =>
  [
    "The writing rules held the reply text below. The user did not see it.",
    ...held.map(({ reply, feedback }) => `<held-reply>\n${reply}\n</held-reply>\n\n${feedback}`),
    "Write the full reply again. Correct each violation. Do not mention this message.",
  ].join("\n\n")

export async function* holdReply(
  $: HoldApi,
  e: StepEvent,
  next: StepNext,
): AsyncGenerator<Piece, StepResult> {
  if (e.agentId !== undefined) return yield* next(e)
  if (turn.id !== e.turnId) {
    turn = {
      id: e.turnId,
      blocks: 0,
      held: [],
      blocked: [],
      noticeIsLast: false,
      uncheckedIsLast: false,
    }
  }
  if (turn.blocks >= BLOCK_LIMIT || !(await strictSession($))) {
    turn.noticeIsLast = false
    turn.uncheckedIsLast = true
    return yield* next(e)
  }

  const { pieces, result } = await readAll(next(e))
  if (next.signal.aborted) return result
  if (result.answer.trim() === "") {
    yield* pieces
    return result
  }

  turn.noticeIsLast = false
  turn.uncheckedIsLast = false
  let feedback: string | undefined
  try {
    feedback = await replyFeedback($, result.answer)
  } catch (error) {
    if (next.signal.aborted) return result
    turn.uncheckedIsLast = true
    const cause = error instanceof Error ? error.message : String(error)
    $.ui.log(`Writing-rule reply check error: ${cause}. The reply is allowed.`)
  }
  if (next.signal.aborted) return result
  if (feedback === undefined) {
    yield* pieces
    return result
  }

  turn.held.push({ reply: result.answer, feedback })
  turn.noticeIsLast = true
  yield* noticePieces(pieces)
  return result
}

export async function* restoreReply(
  _$: unknown,
  e: StepEvent,
  next: StepNext & { readonly called: boolean },
): AsyncGenerator<Piece, StepResult> {
  if (!next.called) return yield* next(e)
  const { result } = await readAll(next(e))
  if (next.signal.aborted) return result
  if (result.answer !== "") {
    if (e.agentId === undefined) Object.assign(turn, { noticeIsLast: false, uncheckedIsLast: true })
    yield { kind: "text", index: 0, text: result.answer }
  }
  for (const [offset, use] of result.toolUses.entries()) {
    const index = offset + 1
    yield { kind: "tool", index, id: `toolu_hold_${e.turnId}_${e.index}_${index}`, name: use.name }
    yield { kind: "input", index, json: JSON.stringify(use.input) }
  }
  yield { kind: "stop", stopReason: result.stopReason, usage: result.usage }
  return result
}

export async function blockHeldReply(
  _$: unknown,
  e: StopEvent,
  next: (e: StopEvent) => Promise<StopResult>,
): Promise<StopResult> {
  const held = turn.held.splice(0)
  if (!turn.noticeIsLast || turn.blocks >= BLOCK_LIMIT) {
    const result = await next(e)
    if (result.block !== undefined && turn.uncheckedIsLast && e.stop_hook_active !== true) {
      turn.blocks += 1
    }
    return result
  }
  if (held.length > 0) turn.blocked = held
  turn.blocks += 1
  return { block: blockReason(turn.blocked) }
}
