import { execFile } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url))
const cliPath = join(repoRoot, "src", "cli", "main.ts")

export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

export interface CliOptions {
  stdin?: string
  cwd?: string
  home?: string
  xdgConfigHome?: string
  xdgStateHome?: string
  agentDir?: string
  preload?: string
  dictionaryPath?: string
  observe?: string
}

export const makeTempDir = (): Promise<string> => mkdtemp(join(tmpdir(), "ste-cli-"))

// HOME defaults to an empty temp dir so tests never read the developer's real global config.
const hermeticHome = makeTempDir()

export async function runCli(args: string[], options: CliOptions = {}): Promise<CliResult> {
  const home = options.home ?? (await hermeticHome)
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: options.xdgConfigHome ?? join(home, ".config"),
    XDG_STATE_HOME: options.xdgStateHome ?? join(home, ".local", "state"),
    PI_CODING_AGENT_DIR: options.agentDir,
    SIMPLE_ENGLISH_OBSERVE: options.observe,
    ...(options.dictionaryPath === undefined
      ? {}
      : { SIMPLE_ENGLISH_DICTIONARY: options.dictionaryPath }),
  }
  return new Promise((resolve, reject) => {
    const child = execFile(
      "bun",
      [...(options.preload === undefined ? [] : ["--preload", options.preload]), cliPath, ...args],
      { cwd: options.cwd ?? repoRoot, env },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : 0
        if (error && typeof error.code !== "number") {
          reject(error)
          return
        }
        resolve({ code, stdout, stderr })
      },
    )
    if (options.stdin !== undefined) {
      child.stdin?.write(options.stdin)
    }
    child.stdin?.end()
  })
}
