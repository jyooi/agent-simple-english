import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

interface SessionState {
  readonly version: 2
  readonly lastProcessedReply: string
  readonly pendingFeedback?: string
}

const isMissingFile = (cause: unknown): boolean =>
  typeof cause === "object" && cause !== null && (cause as { code?: string }).code === "ENOENT"

const stateRoot = (): string => {
  const configured = process.env.XDG_STATE_HOME
  return configured && isAbsolute(configured) ? configured : join(homedir(), ".local", "state")
}

const sessionsDirectory = (): string => join(stateRoot(), "simple-english", "sessions")

const sessionKey = (sessionId: string): string =>
  createHash("sha256").update(sessionId).digest("hex")

const sessionPath = (sessionId: string): string =>
  join(sessionsDirectory(), `${sessionKey(sessionId)}.json`)

function decodeState(text: string, path: string): SessionState | { readonly pendingFeedback: string } {
  const value = JSON.parse(text) as unknown
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`invalid session state in ${path}`)
  }
  const state = value as Record<string, unknown>
  if (state.version === 1 && typeof state.pendingFeedback === "string") {
    return { pendingFeedback: state.pendingFeedback }
  }
  if (
    state.version !== 2 ||
    typeof state.lastProcessedReply !== "string" ||
    state.lastProcessedReply.length === 0 ||
    (state.pendingFeedback !== undefined && typeof state.pendingFeedback !== "string")
  ) {
    throw new Error(`invalid session state in ${path}`)
  }
  return {
    version: 2,
    lastProcessedReply: state.lastProcessedReply,
    ...(state.pendingFeedback === undefined
      ? {}
      : { pendingFeedback: state.pendingFeedback as string }),
  }
}

async function readState(sessionId: string): Promise<ReturnType<typeof decodeState> | undefined> {
  const path = sessionPath(sessionId)
  try {
    return decodeState(await readFile(path, "utf8"), path)
  } catch (cause) {
    if (isMissingFile(cause)) return undefined
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

export async function hasProcessedReply(
  sessionId: string,
  replyIdentity: string,
): Promise<boolean> {
  const state = await readState(sessionId)
  return state !== undefined && "lastProcessedReply" in state
    ? state.lastProcessedReply === replyIdentity
    : false
}

export async function setReplyFeedback(
  sessionId: string,
  replyIdentity: string,
  pendingFeedback: string | undefined,
): Promise<void> {
  if (await hasProcessedReply(sessionId, replyIdentity)) return
  await writeState(sessionId, {
    version: 2,
    lastProcessedReply: replyIdentity,
    ...(pendingFeedback === undefined ? {} : { pendingFeedback }),
  })
}

export async function consumePendingFeedback(sessionId: string): Promise<string | undefined> {
  const path = sessionPath(sessionId)
  const claimedPath = `${path}.${randomUUID()}.claimed`
  try {
    await rename(path, claimedPath)
  } catch (cause) {
    if (isMissingFile(cause)) return undefined
    throw cause
  }

  try {
    const state = decodeState(await readFile(claimedPath, "utf8"), claimedPath)
    if (!("lastProcessedReply" in state)) return state.pendingFeedback
    await writeState(sessionId, {
      version: 2,
      lastProcessedReply: state.lastProcessedReply,
    })
    return state.pendingFeedback
  } finally {
    await rm(claimedPath, { force: true })
  }
}
