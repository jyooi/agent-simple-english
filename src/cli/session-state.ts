import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

interface SessionState {
  readonly version: 1
  readonly pendingFeedback: string
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

function decodeState(text: string, path: string): SessionState {
  const value = JSON.parse(text) as unknown
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`invalid session state in ${path}`)
  }
  const state = value as Record<string, unknown>
  if (state.version !== 1 || typeof state.pendingFeedback !== "string") {
    throw new Error(`invalid session state in ${path}`)
  }
  return { version: 1, pendingFeedback: state.pendingFeedback }
}

export async function setPendingFeedback(
  sessionId: string,
  pendingFeedback: string | undefined,
): Promise<void> {
  const path = sessionPath(sessionId)
  if (pendingFeedback === undefined) {
    await rm(path, { force: true })
    return
  }

  const directory = sessionsDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporaryPath = join(directory, `.${sessionKey(sessionId)}.${randomUUID()}.tmp`)
  try {
    const state: SessionState = { version: 1, pendingFeedback }
    await writeFile(temporaryPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
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
    return decodeState(await readFile(claimedPath, "utf8"), claimedPath).pendingFeedback
  } finally {
    await rm(claimedPath, { force: true })
  }
}
