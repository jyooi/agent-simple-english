import { access, readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

interface CommandHook {
  readonly type: "command"
  readonly command: string
}

interface HookRegistration {
  readonly matcher?: string
  readonly hooks: readonly CommandHook[]
}

interface HooksFile {
  readonly hooks: Readonly<Record<string, readonly HookRegistration[]>>
}

const repoRoot = process.cwd()
const pluginManifestPath = join(repoRoot, ".claude-plugin", "plugin.json")
const marketplaceManifestPath = join(repoRoot, ".claude-plugin", "marketplace.json")
const hooksPath = join(repoRoot, "hooks", "hooks.json")
const steCommandPath = join(repoRoot, "commands", "ste.md")

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown
}

describe("Claude Code plugin wiring", () => {
  test("declares a local marketplace plugin", async () => {
    const plugin = (await readJson(pluginManifestPath)) as Record<string, unknown>
    const marketplace = (await readJson(marketplaceManifestPath)) as {
      name: string
      plugins: Array<Record<string, unknown>>
    }
    const packageManifest = (await readJson(join(repoRoot, "package.json"))) as {
      version: string
      files: string[]
    }

    expect(plugin).toMatchObject({
      name: "simple-english",
      version: packageManifest.version,
      repository: "https://github.com/jyooi/agent-simple-english",
    })
    expect(packageManifest.files).toEqual(
      expect.arrayContaining([".claude-plugin", "commands", "hooks", "src"]),
    )
    expect(marketplace.name).toBe("agent-simple-english")
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({
        name: "simple-english",
        version: packageManifest.version,
        source: "./",
      }),
    ])
  })

  test("defines the session STE command", async () => {
    const command = await readFile(steCommandPath, "utf8")

    expect(command).toContain("description: Control STE for this Claude Code session")
    expect(command).toContain("argument-hint: on|off|status|strict|strict off")
    expect(command).toContain("${CLAUDE_PLUGIN_ROOT}")
    expect(command).toContain("${CLAUDE_SESSION_ID}")
    expect(command).toContain("${CLAUDE_PROJECT_DIR}")
    expect(command).toContain("$ARGUMENTS")
    expect(command).toContain('src/cli/main.ts" session')
  })

  test("registers the session, tool gate, and reply feedback hooks", async () => {
    const hookFile = (await readJson(hooksPath)) as HooksFile

    expect(Object.keys(hookFile.hooks).sort()).toEqual([
      "PreToolUse",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ])
    expect(hookFile.hooks.SessionStart).toEqual([
      {
        hooks: [
          expect.objectContaining({
            type: "command",
            command: expect.stringContaining('src/cli/main.ts" hook'),
          }),
        ],
      },
    ])
    expect(hookFile.hooks.PreToolUse).toEqual([
      {
        matcher: "Write|Edit|Bash",
        hooks: [
          expect.objectContaining({
            type: "command",
            command: expect.stringContaining('src/cli/main.ts" hook'),
          }),
        ],
      },
    ])
    for (const hookName of ["Stop", "UserPromptSubmit"] as const) {
      expect(hookFile.hooks[hookName]).toEqual([
        {
          hooks: [
            expect.objectContaining({
              type: "command",
              command: expect.stringContaining('src/cli/main.ts" hook'),
            }),
          ],
        },
      ])
    }
  })

  test("references CLI entry points that exist in the plugin", async () => {
    const hookFile = (await readJson(hooksPath)) as HooksFile
    const commands = Object.values(hookFile.hooks).flatMap((registrations) =>
      registrations.flatMap((registration) => registration.hooks.map((hook) => hook.command)),
    )

    expect(commands).toHaveLength(4)
    for (const command of commands) {
      const match = command.match(/^cd "\$\{CLAUDE_PLUGIN_ROOT\}" && bun "([^"]+)" hook$/u)
      expect(match).not.toBeNull()
      await expect(access(join(repoRoot, match?.[1] ?? ""))).resolves.toBeUndefined()
    }
  })
})
