import { access, readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { aseSuggestions, register } from "../../hooks/register.ts"

interface CommandHook {
  readonly type: "command"
  readonly command: string
}

interface HookRegistration {
  readonly matcher?: string
  readonly hooks: readonly CommandHook[]
}

interface HooksFile {
  readonly modules?: readonly string[]
  readonly hooks: Readonly<Record<string, readonly HookRegistration[]>>
}

const repoRoot = process.cwd()
const pluginManifestPath = join(repoRoot, ".claude-plugin", "plugin.json")
const marketplaceManifestPath = join(repoRoot, ".claude-plugin", "marketplace.json")
const hooksPath = join(repoRoot, "hooks", "hooks.json")
const aseCommandPath = join(repoRoot, "commands", "ase.md")
const steCommandPath = join(repoRoot, "commands", "ste.md")

function frontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/u)
  if (match === null) throw new Error("command file has no frontmatter")
  return Object.fromEntries(
    (match[1] ?? "").split("\n").map((line) => {
      const separator = line.indexOf(":")
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
    }),
  )
}

function suggest(text: string): string[] {
  const start = text.lastIndexOf(" ") + 1
  return aseSuggestions(text, text.slice(start), start).map((row) => row.text)
}

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

  test("defines only the session ASE command", async () => {
    const command = await readFile(aseCommandPath, "utf8")

    await expect(access(steCommandPath)).rejects.toThrow()

    expect(frontmatter(command)).toMatchObject({
      description: "Control writing-rule enforcement for this Claude Code session",
      "argument-hint": "on|off|status|strict|strict off|explain",
    })
    // biome-ignore-start lint/suspicious/noTemplateCurlyInString: the test checks the literal placeholder text
    expect(command).toContain("${CLAUDE_PLUGIN_ROOT}")
    expect(command).toContain("${CLAUDE_SESSION_ID}")
    expect(command).toContain("${CLAUDE_PROJECT_DIR}")
    // biome-ignore-end lint/suspicious/noTemplateCurlyInString: the test checks the literal placeholder text
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

  test("loads the argument suggestion module beside the command hooks", async () => {
    const hookFile = (await readJson(hooksPath)) as HooksFile
    const events: string[] = []

    expect(hookFile.modules).toEqual(["./register.ts"])
    register((event) => {
      events.push(event)
    })
    expect(events).toEqual(["prompt.autocomplete"])
  })

  test("suggests the ASE arguments that start with the typed word", () => {
    expect(suggest("/simple-english:ase o")).toEqual(["on", "off"])
    expect(suggest("/ase o")).toEqual(["on", "off"])
    expect(suggest("/ase S")).toEqual(["status", "strict"])
    expect(suggest("/ase e")).toEqual(["explain"])
    expect(suggest("/ase strict o")).toEqual(["off"])
    expect(aseSuggestions("/ase o", "o", 5)).toEqual([
      { text: "on", description: "Enable write, edit, commit, and reply checks" },
      { text: "off", description: "Disable all checks and leave strict mode" },
    ])
  })

  test("suggests nothing outside the ASE argument", () => {
    expect(suggest("/ase x")).toEqual([])
    expect(suggest("/ase on o")).toEqual([])
    expect(suggest("/ase strict off o")).toEqual([])
    expect(suggest("/aseo")).toEqual([])
    expect(suggest("/other o")).toEqual([])
    expect(suggest("please turn o")).toEqual([])
  })

  test("removes a suggestion that the typed word already equals", () => {
    expect(suggest("/ase on")).toEqual([])
    expect(suggest("/ase strict")).toEqual([])
    expect(suggest("/ase strict off")).toEqual([])
  })
})
