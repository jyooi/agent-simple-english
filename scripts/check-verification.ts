import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"

interface Break {
  readonly find: string
  readonly replace: string
}

interface Property {
  readonly name: string
  readonly status: "holds" | "finding"
  readonly break?: Break
}

interface VerificationRecord {
  readonly tool: { readonly version: string; readonly url: string; readonly sha256: string }
  readonly model: { readonly spec: string; readonly config: string }
  readonly covers: readonly { readonly file: string; readonly sha256: string }[]
  readonly properties: readonly Property[]
}

interface TlcRun {
  readonly code: number
  readonly output: string
}

const runFile = promisify(execFile)
const repositoryRoot = join(import.meta.dirname, "..")
const skillName = "verify-reply-hold"
const skillDirectory = join(repositoryRoot, ".claude", "skills", skillName)
const passed = "Model checking completed. No error has been found."

const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex")

const violated = (run: TlcRun, name: string): boolean =>
  run.output.includes(`Invariant ${name} is violated`)

const tlcError = (run: TlcRun): string => {
  const lines = run.output.split("\n")
  const start = lines.findIndex((line) => line.startsWith("Error:"))
  return lines
    .slice(start === -1 ? 0 : start)
    .slice(0, 200)
    .join("\n")
}

export const hasStateChartPart = (text: string): boolean =>
  /^#{1,6} State chart[ \t]*\r?\n[\s\S]*?(?:```mermaid|No state change)/imu.test(text)

function hasSkill(): boolean {
  const path = join(skillDirectory, "SKILL.md")
  if (!existsSync(path) || !existsSync(join(skillDirectory, "record.json"))) return false
  const frontmatter = /^---\n([\s\S]*?)\n---\n/u.exec(readFileSync(path, "utf8"))?.[1]
  return (
    frontmatter !== undefined &&
    new RegExp(`^name: ${skillName}$`, "mu").test(frontmatter) &&
    /^description: \S/mu.test(frontmatter)
  )
}

async function tlaTools(tool: VerificationRecord["tool"]): Promise<string> {
  const path =
    process.env.TLA2TOOLS_JAR ??
    join(repositoryRoot, "node_modules", ".cache", "tla2tools", tool.version, "tla2tools.jar")
  if (!existsSync(path)) {
    const response = await fetch(tool.url)
    if (!response.ok) throw new Error(`cannot download ${tool.url}: HTTP ${response.status}`)
    const jar = new Uint8Array(await response.arrayBuffer())
    if (sha256(jar) !== tool.sha256) {
      throw new Error(`${tool.url} has SHA-256 ${sha256(jar)}, not the pinned ${tool.sha256}`)
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(`${path}.download`, jar)
    await rename(`${path}.download`, path)
  }
  const actual = sha256(await readFile(path))
  if (actual !== tool.sha256) {
    throw new Error(`${path} has SHA-256 ${actual}, not the pinned ${tool.sha256}`)
  }
  return path
}

async function tlc(
  jar: string,
  specName: string,
  spec: string,
  config: string,
  checkDeadlock: boolean,
): Promise<TlcRun> {
  const directory = await mkdtemp(join(tmpdir(), `${skillName}-`))
  try {
    await writeFile(join(directory, specName), spec)
    await writeFile(join(directory, "Check.cfg"), config)
    const args = [
      "-XX:+UseParallelGC",
      "-cp",
      jar,
      "tlc2.TLC",
      "-workers",
      "1",
      ...(checkDeadlock ? [] : ["-deadlock"]),
      "-metadir",
      join(directory, "states"),
      "-config",
      "Check.cfg",
      specName,
    ]
    try {
      const { stdout, stderr } = await runFile("java", args, {
        cwd: directory,
        maxBuffer: 64 * 1024 * 1024,
      })
      return { code: 0, output: `${stdout}${stderr}` }
    } catch (error) {
      const failure = error as { code?: unknown; stdout?: string; stderr?: string }
      if (typeof failure.code !== "number") throw error
      return { code: failure.code, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function githubJson(path: string): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN
  const response = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token === undefined || token === "" ? {} : { authorization: `Bearer ${token}` }),
    },
  })
  if (!response.ok) throw new Error(`cannot read ${path}: HTTP ${response.status}`)
  return response.json()
}

async function checkPullRequest(): Promise<string[]> {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (process.env.GITHUB_EVENT_NAME !== "pull_request" || eventPath === undefined) {
    console.log("State chart part: not checked, because this run has no pull request data.")
    return []
  }
  const event = JSON.parse(await readFile(eventPath, "utf8")) as {
    pull_request?: { number?: number }
  }
  const number = event.pull_request?.number
  const repository = process.env.GITHUB_REPOSITORY
  if (number === undefined || repository === undefined) {
    return ["The pull request event has no pull request number or repository."]
  }
  const pull = (await githubJson(`/repos/${repository}/pulls/${number}`)) as {
    body?: string | null
  }
  const comments = (await githubJson(
    `/repos/${repository}/issues/${number}/comments?per_page=100`,
  )) as { body?: string | null }[]
  const texts = [pull.body ?? "", ...comments.map((comment) => comment.body ?? "")]
  if (texts.some(hasStateChartPart)) {
    console.log(`State chart part: found in pull request ${number}.`)
    return []
  }
  return [
    `Pull request ${number} has no State chart part. Add a "State chart" heading with a mermaid chart of the changed behavior, or with the words "No state change", to the PR text or to one PR comment. Then run this job again.`,
  ]
}

async function checkModel(record: VerificationRecord): Promise<string[]> {
  const spec = await readFile(join(skillDirectory, record.model.spec), "utf8")
  const config = await readFile(join(skillDirectory, record.model.config), "utf8")
  const [base = "", invariantBlock = ""] = config.split(/^INVARIANTS\n/mu)
  const configured = invariantBlock.split(/\s+/u).filter((name) => name !== "")
  const recorded = ["TypeOK", ...record.properties.map((property) => property.name)]
  const problems =
    configured.join(" ") === recorded.join(" ")
      ? []
      : [
          `${record.model.config} lists the invariants ${configured.join(", ")}, but record.json lists ${recorded.join(", ")}. Make the two lists the same.`,
        ]
  const withInvariants = (names: readonly string[]): string =>
    `${base}INVARIANTS\n${names.map((name) => `  ${name}\n`).join("")}`

  const jar = await tlaTools(record.tool)
  const specName = basename(record.model.spec)
  const holding = record.properties.filter((property) => property.status === "holds")
  const findings = record.properties.filter((property) => property.status === "finding")

  const holdsRun = tlc(
    jar,
    specName,
    spec,
    withInvariants(["TypeOK", ...holding.map((property) => property.name)]),
    true,
  ).then((run) => {
    if (run.code !== 0 || !run.output.includes(passed)) {
      return [`The verification check fails:\n${tlcError(run)}`]
    }
    const states = /([\d,]+) distinct states found/u.exec(run.output)?.[1] ?? "?"
    console.log(`Properties that hold: ${holding.map((property) => property.name).join(", ")}.`)
    console.log(`TLC ${record.tool.version} checked ${states} distinct states.`)
    return []
  })

  const findingRuns = findings.map((property) =>
    tlc(jar, specName, spec, withInvariants([property.name]), false).then((run) => {
      if (violated(run, property.name)) {
        console.log(`Recorded finding ${property.name} still breaks.`)
        return []
      }
      if (run.code === 0) {
        return [
          `The recorded finding ${property.name} no longer breaks. Confirm the fix, set its status to holds, and record a break for it.`,
        ]
      }
      return [`The verification check fails on ${property.name}:\n${tlcError(run)}`]
    }),
  )

  const breakRuns = holding.map((property) => {
    const recordedBreak = property.break
    if (recordedBreak === undefined) {
      return Promise.resolve([`Property ${property.name} has no recorded break in record.json.`])
    }
    if (spec.split(recordedBreak.find).length !== 2) {
      return Promise.resolve([
        `The recorded break of ${property.name} does not match the model exactly one time. Update the break in record.json.`,
      ])
    }
    const broken = spec.replace(recordedBreak.find, recordedBreak.replace)
    return tlc(jar, specName, broken, withInvariants([property.name]), false).then((run) => {
      if (violated(run, property.name)) {
        console.log(`Recorded break of ${property.name} is caught.`)
        return []
      }
      return [
        `The verification does not catch the recorded break of ${property.name}. The property cannot fail, so correct the model or the property.`,
      ]
    })
  })

  const results = await Promise.all([holdsRun, ...findingRuns, ...breakRuns])
  return [...problems, ...results.flat()]
}

async function check(): Promise<string[]> {
  if (!hasSkill()) {
    return [
      `The repository has no verification skill. Expected ${join(".claude", "skills", skillName, "SKILL.md")} with name and description frontmatter, and record.json beside it.`,
    ]
  }
  const record = JSON.parse(
    await readFile(join(skillDirectory, "record.json"), "utf8"),
  ) as VerificationRecord
  const problems: string[] = []
  for (const cover of record.covers) {
    const path = join(repositoryRoot, cover.file)
    if (!existsSync(path)) {
      problems.push(`Verified file ${cover.file} is missing. Update the model and record.json.`)
      continue
    }
    const actual = sha256(await readFile(path))
    if (actual !== cover.sha256) {
      problems.push(
        `Verified code changed and the verification record did not: ${cover.file} has SHA-256 ${actual}, record.json has ${cover.sha256}. Follow the ${skillName} skill to confirm the model, then record the new digest.`,
      )
    }
  }
  const [modelProblems, pullRequestProblems] = await Promise.all([
    checkModel(record),
    checkPullRequest(),
  ])
  return [...problems, ...modelProblems, ...pullRequestProblems]
}

if (import.meta.main) {
  const started = performance.now()
  const problems = await check()
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  if (problems.length > 0) {
    console.error(`Verification failed in ${seconds} s:\n\n${problems.join("\n\n")}`)
    process.exit(1)
  }
  console.log(`Verification passed in ${seconds} s.`)
}
