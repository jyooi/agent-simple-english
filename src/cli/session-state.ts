import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

export interface SessionControl {
  readonly enabled: boolean
  readonly strict: boolean
}

interface SessionState extends SessionControl {
  readonly version: 3
  readonly lastProcessedReply?: string
  readonly pendingFeedback?: string
}

const DEFAULT_CONTROL: SessionControl = { enabled: true, strict: false }
const LOCK_STALE_MILLISECONDS = 10_000
const LOCK_RETRY_MILLISECONDS = 5
const LOCK_RETRIES = 200

const isFileError = (cause: unknown, code: string): boolean =>
  typeof cause === "object" && cause !== null && (cause as { code?: string }).code === code

const stateRoot = (): string => {
  const configured = process.env.XDG_STATE_HOME
  return configured && isAbsolute(configured) ? configured : join(homedir(), ".local", "state")
}

const sessionsDirectory = (): string => join(stateRoot(), "simple-english", "sessions")

const sessionKey = (sessionId: string): string =>
  createHash("sha256").update(sessionId).digest("hex")

const sessionPath = (sessionId: string): string =>
  join(sessionsDirectory(), `${sessionKey(sessionId)}.json`)

const lockPath = (sessionId: string): string =>
  join(sessionsDirectory(), `.${sessionKey(sessionId)}.lock`)

function optionalString(state: Record<string, unknown>, name: string): string | undefined {
  const value = state[name]
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${name} must be a string`)
  }
  return value as string | undefined
}

function decodeState(text: string, path: string): SessionState {
  const value = JSON.parse(text) as unknown
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`invalid session state in ${path}`)
  }
  const state = value as Record<string, unknown>
  const pendingFeedback = optionalString(state, "pendingFeedback")
  if (state.version === 1 && typeof pendingFeedback === "string") {
    return { version: 3, ...DEFAULT_CONTROL, pendingFeedback }
  }
  const lastProcessedReply = optionalString(state, "lastProcessedReply")
  if (state.version === 2 && lastProcessedReply !== undefined && lastProcessedReply.length > 0) {
    return {
      version: 3,
      ...DEFAULT_CONTROL,
      lastProcessedReply,
      ...(pendingFeedback === undefined ? {} : { pendingFeedback }),
    }
  }
  if (
    state.version !== 3 ||
    typeof state.enabled !== "boolean" ||
    typeof state.strict !== "boolean" ||
    (state.strict && !state.enabled) ||
    lastProcessedReply === ""
  ) {
    throw new Error(`invalid session state in ${path}`)
  }
  return {
    version: 3,
    enabled: state.enabled,
    strict: state.strict,
    ...(lastProcessedReply === undefined ? {} : { lastProcessedReply }),
    ...(pendingFeedback === undefined ? {} : { pendingFeedback }),
  }
}

async function readState(sessionId: string): Promise<SessionState | undefined> {
  const path = sessionPath(sessionId)
  try {
    return decodeState(await readFile(path, "utf8"), path)
  } catch (cause) {
    if (isFileError(cause, "ENOENT")) return undefined
    throw cause
  }
}

async function writeState(sessionId: string, state: SessionState): Promise<void> {
  const directory = sessionsDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporaryPath = join(directory, `.${sessionKey(sessionId)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 })
    await rename(temporaryPath, sessionPath(sessionId))
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

async function acquireLock(sessionId: string): Promise<() => Promise<void>> {
  const directory = sessionsDirectory()
  const path = lockPath(sessionId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
    try {
      await mkdir(path, { mode: 0o700 })
      return () => rm(path, { recursive: true, force: true })
    } catch (cause) {
      if (!isFileError(cause, "EEXIST")) throw cause
      try {
        const lockStat = await stat(path)
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MILLISECONDS) {
          await rm(path, { recursive: true, force: true })
          continue
        }
      } catch (statCause) {
        if (!isFileError(statCause, "ENOENT")) throw statCause
      }
      await wait(LOCK_RETRY_MILLISECONDS)
    }
  }
  throw new Error(`timed out while reading session ${sessionId}`)
}

async function withStateLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const release = await acquireLock(sessionId)
  try {
    return await operation()
  } finally {
    await release()
  }
}

const currentState = (state: SessionState | undefined): SessionState =>
  state ?? { version: 3, ...DEFAULT_CONTROL }

export async function getSessionControl(sessionId: string): Promise<SessionControl> {
  return withStateLock(sessionId, async () => {
    const { enabled, strict } = currentState(await readState(sessionId))
    return { enabled, strict }
  })
}

export async function setSessionEnabled(sessionId: string, enabled: boolean): Promise<void> {
  await withStateLock(sessionId, async () => {
    const state = currentState(await readState(sessionId))
    await writeState(sessionId, {
      ...state,
      enabled,
      strict: enabled ? state.strict : false,
      ...(enabled || state.pendingFeedback === undefined ? {} : { pendingFeedback: undefined }),
    })
  })
}

export async function setSessionStrict(sessionId: string, strict: boolean): Promise<void> {
  await withStateLock(sessionId, async () => {
    const state = currentState(await readState(sessionId))
    await writeState(sessionId, {
      ...state,
      enabled: strict ? true : state.enabled,
      strict,
    })
  })
}

export async function hasProcessedReply(
  sessionId: string,
  replyIdentity: string,
): Promise<boolean> {
  return withStateLock(sessionId, async () => {
    const state = await readState(sessionId)
    return state?.lastProcessedReply === replyIdentity
  })
}

export async function setReplyFeedback(
  sessionId: string,
  replyIdentity: string,
  pendingFeedback: string | undefined,
): Promise<SessionControl | undefined> {
  return withStateLock(sessionId, async () => {
    const state = currentState(await readState(sessionId))
    if (!state.enabled || state.lastProcessedReply === replyIdentity) return undefined
    await writeState(sessionId, {
      ...state,
      lastProcessedReply: replyIdentity,
      ...(state.strict || pendingFeedback === undefined
        ? { pendingFeedback: undefined }
        : { pendingFeedback }),
    })
    return { enabled: state.enabled, strict: state.strict }
  })
}

export async function consumePendingFeedback(sessionId: string): Promise<string | undefined> {
  return withStateLock(sessionId, async () => {
    const state = await readState(sessionId)
    if (state?.pendingFeedback === undefined) return undefined
    await writeState(sessionId, { ...state, pendingFeedback: undefined })
    return state.pendingFeedback
  })
}
