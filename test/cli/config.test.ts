import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { makeTempDir, runCli } from "./run-cli.ts"

const tenWords = "one two three four five six seven eight nine ten."

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2))
}

const makeProject = async (config?: unknown): Promise<string> => {
  const cwd = await makeTempDir()
  if (config !== undefined) await writeJson(join(cwd, ".simple-english.json"), config)
  return cwd
}

const writeLegacyProjectConfig = (cwd: string, config: unknown): Promise<void> =>
  writeJson(join(cwd, ".pi", "simple-english.json"), config)

const makeHome = async (config: unknown): Promise<string> => {
  const home = await makeTempDir()
  await writeJson(join(home, ".config", "simple-english", "config.json"), config)
  return home
}

const writeLegacyGlobalConfig = (home: string, config: unknown): Promise<void> =>
  writeJson(join(home, ".pi", "agent", "simple-english.json"), config)

describe("simple-english CLI config", () => {
  test("project config changes the sentence word cap", async () => {
    const cwd = await makeProject({ maxSentenceWords: 5 })
    const result = await runCli([], { cwd, stdin: tenWords })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("maximum is 5")
  })

  test("global config in the XDG config directory applies", async () => {
    const home = await makeHome({ maxSentenceWords: 5 })
    const cwd = await makeProject()
    const result = await runCli([], { cwd, home, stdin: tenWords })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("maximum is 5")
  })

  test("XDG_CONFIG_HOME sets the global config directory", async () => {
    const home = await makeHome({ maxSentenceWords: 20 })
    const xdgConfigHome = await makeTempDir()
    await writeJson(join(xdgConfigHome, "simple-english", "config.json"), {
      maxSentenceWords: 5,
    })
    const cwd = await makeProject()
    const result = await runCli([], { cwd, home, xdgConfigHome, stdin: tenWords })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("maximum is 5")
  })

  test("legacy pi project and global configs apply when new configs are absent", async () => {
    const home = await makeTempDir()
    await writeLegacyGlobalConfig(home, {
      maxSentenceWords: 5,
      rules: { "sentence-length": "soft" },
    })
    const cwd = await makeProject()
    await writeLegacyProjectConfig(cwd, { maxSentenceWords: 8 })
    const result = await runCli(["--json"], { cwd, home, stdin: tenWords })

    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.violations[0].severity).toBe("soft")
    expect(report.violations[0].message).toContain("maximum is 8")
  })

  test("PI_CODING_AGENT_DIR sets the legacy global fallback directory", async () => {
    const home = await makeTempDir()
    await writeLegacyGlobalConfig(home, { maxSentenceWords: 20 })
    const agentDir = await makeTempDir()
    await writeJson(join(agentDir, "simple-english.json"), { maxSentenceWords: 5 })
    const cwd = await makeProject()
    const result = await runCli([], { cwd, home, agentDir, stdin: tenWords })

    expect(result.code).toBe(1)
    expect(result.stdout).toContain("maximum is 5")
  })

  test("new locations replace legacy locations at each config level", async () => {
    const home = await makeHome({
      maxSentenceWords: 5,
      rules: { "sentence-length": "soft" },
    })
    await writeLegacyGlobalConfig(home, { rules: { "sentence-length": "off" } })
    const cwd = await makeProject({ maxSentenceWords: 8 })
    await writeLegacyProjectConfig(cwd, { maxSentenceWords: 20 })
    const result = await runCli(["--json"], { cwd, home, stdin: tenWords })

    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.violations[0].severity).toBe("soft")
    expect(report.violations[0].message).toContain("maximum is 8")
  })

  test("project config deep-merges over global with project winning per key", async () => {
    const home = await makeHome({ maxSentenceWords: 5, rules: { "sentence-length": "soft" } })
    const cwd = await makeProject({ maxSentenceWords: 8 })
    const result = await runCli(["--json"], { cwd, home, stdin: tenWords })

    expect(result.code).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0].severity).toBe("soft")
    expect(report.violations[0].message).toContain("maximum is 8")
  })

  test("a rule set to off in project config is suppressed", async () => {
    const cwd = await makeProject({ maxSentenceWords: 5, rules: { "sentence-length": "off" } })
    const result = await runCli([], { cwd, stdin: tenWords })

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe("")
  })

  test("--config points at an explicit file and ignores discovered configs", async () => {
    const cwd = await makeProject({ maxSentenceWords: 5 })
    const explicit = join(await makeTempDir(), "custom.json")
    await writeJson(explicit, { rules: { "sentence-length": "off" } })
    const result = await runCli(["--config", explicit], { cwd, stdin: tenWords })

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe("")
  })

  test("an invalid config file exits 2 with a readable error naming the file and key", async () => {
    const cwd = await makeProject({ rules: { "sentence-length": "warn" } })
    const result = await runCli([], { cwd, stdin: "A short sentence." })

    expect(result.code).toBe(2)
    expect(result.stderr).toContain(join(cwd, ".simple-english.json"))
    expect(result.stderr).toContain("sentence-length")
    expect(result.stderr).toContain("warn")
    expect(result.stderr).not.toContain("FiberFailure")
    expect(result.stderr).not.toContain("at <anonymous>")
  })

  test("a config file with malformed JSON exits 2 naming the file", async () => {
    const cwd = await makeProject()
    await writeFile(join(cwd, ".simple-english.json"), "{ not json")
    const result = await runCli([], { cwd, stdin: "A short sentence." })

    expect(result.code).toBe(2)
    expect(result.stderr).toContain(join(cwd, ".simple-english.json"))
  })

  test("a missing explicit --config file exits 2 naming the path", async () => {
    const cwd = await makeProject()
    const missing = join(cwd, "nope.json")
    const result = await runCli(["--config", missing], { cwd, stdin: "A short sentence." })

    expect(result.code).toBe(2)
    expect(result.stderr).toContain(missing)
  })

  test("--config without a path exits 2 with a usage error", async () => {
    const result = await runCli(["--config"], { stdin: "A short sentence." })

    expect(result.code).toBe(2)
    expect(result.stderr).toContain("--config")
  })

  test("defaults apply when no config files exist", async () => {
    const cwd = await makeProject()
    const result = await runCli([], { cwd, stdin: tenWords })

    expect(result.code).toBe(0)
  })
})
