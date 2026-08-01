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
      expect.arrayContaining([".claude-plugin", "hooks", "src"]),
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

  test("registers only the SessionStart and gated PreToolUse hooks", async () => {
    const hookFile = (await readJson(hooksPath)) as HooksFile

    expect(Object.keys(hookFile.hooks).sort()).toEqual(["PreToolUse", "SessionStart"])
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
  })

  test("references CLI entry points that exist in the plugin", async () => {
    const hookFile = (await readJson(hooksPath)) as HooksFile
    const commands = Object.values(hookFile.hooks).flatMap((registrations) =>
      registrations.flatMap((registration) => registration.hooks.map((hook) => hook.command)),
    )

    expect(commands).toHaveLength(2)
    for (const command of commands) {
      const match = command.match(
        /^cd "\$\{CLAUDE_PLUGIN_ROOT\}" && bun "([^"]+)" hook$/u,
      )
      expect(match).not.toBeNull()
      await expect(access(join(repoRoot, match?.[1] ?? ""))).resolves.toBeUndefined()
    }
  })
})
