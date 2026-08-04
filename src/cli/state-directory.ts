import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

export function applicationStateDirectory(): string {
  const configured = process.env.XDG_STATE_HOME
  const root =
    configured && isAbsolute(configured) ? configured : join(homedir(), ".local", "state")
  return join(root, "simple-english")
}
