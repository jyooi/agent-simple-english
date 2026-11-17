import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, posix } from "node:path"
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
const skillPath = posix.join(".claude", "skills", skillName)
const skillDirectory = join(repositoryRoot, skillPath)
const chartDirectory = posix.join(skillPath, "charts")
const defaultBranch = "origin/main"
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
  const path = join(
    repositoryRoot,
    "node_modules",
    ".cache",
    "tla2tools",
    tool.version,
    "tla2tools.jar",
  )
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

async function coveredDigest(root: string, record: VerificationRecord): Promise<string> {
  const model = await Promise.all(
    [record.model.spec, record.model.config].map(async (name) => {
      const file = posix.join(skillPath, name)
      return { file, sha256: sha256(await readFile(join(root, file))) }
    }),
  )
  return sha256(
    [...record.covers, ...model].map((cover) => `${cover.sha256}  ${cover.file}\n`).join(""),
  )
}

export const chartDigest = (text: string): string | undefined => {
  const body = /^```mermaid[ \t]*\n([\s\S]*?)^```[ \t]*$/mu.exec(text)?.[1]
  return body === undefined ? undefined : sha256(body)
}

const git = async (root: string, ...args: string[]): Promise<string> =>
  (await runFile("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout.trim()

export async function checkChart(root: string, record: VerificationRecord): Promise<string[]> {
  let base: string
  try {
    base = await git(root, "merge-base", defaultBranch, "HEAD")
  } catch {
    return [
      `Cannot find the merge base of HEAD and ${defaultBranch}. Fetch ${defaultBranch} with the full history.`,
    ]
  }
  if (base === (await git(root, "rev-parse", "HEAD"))) {
    console.log(`State chart file: not checked, because HEAD has no change from ${defaultBranch}.`)
    return []
  }
  const changes = (await git(root, "diff", "--name-status", "--no-renames", base, "HEAD"))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\t"))
  const charts = changes
    .filter(
      ([status, path = ""]) =>
        status === "A" && posix.dirname(path) === chartDirectory && path.endsWith(".md"),
    )
    .map(([, path = ""]) => path)
  if (charts.length === 0) {
    return [
      `The change adds no state chart file to ${chartDirectory}. Follow the ${skillName} skill to add one.`,
    ]
  }
  const verified = new Set([
    ...record.covers.map((cover) => cover.file),
    posix.join(skillPath, record.model.spec),
    posix.join(skillPath, record.model.config),
  ])
  const touchesVerification = changes.some(([, path = ""]) => verified.has(path))
  const inChange = new Set(
    changes.filter(([status]) => status !== "D").map(([, path = ""]) => path),
  )
  const digest = await coveredDigest(root, record)
  const problems: string[] = []
  for (const chart of charts) {
    const text = await git(root, "show", `HEAD:${chart}`)
    const drawn = chartDigest(text)
    if (drawn === undefined && !/^No state change\b/mu.test(text)) {
      problems.push(`${chart} has no mermaid chart and no "No state change" note.`)
    }
    if (drawn !== undefined) {
      const image = chart.replace(/\.md$/u, ".svg")
      const named = inChange.has(image)
        ? /Chart digest: ([0-9a-f]{64})/u.exec(await git(root, "show", `HEAD:${image}`))?.[1]
        : undefined
      if (!inChange.has(image)) {
        problems.push(
          `${chart} has a chart, and the change has no SVG image ${image}. Render the chart to that file as the ${skillName} skill says.`,
        )
      } else if (named !== drawn) {
        problems.push(
          `${image} is older than the chart text of ${chart}: the image names chart digest ${named ?? "none"}, and the chart text has ${drawn}. Render the image again from the chart text, and write the new digest in it.`,
        )
      }
    }
    if (touchesVerification && !text.includes(digest)) {
      problems.push(
        `The change touches verified code or the model, and ${chart} does not name the covered digest ${digest}. Confirm the chart against the change, then write the digest in it.`,
      )
    }
  }
  if (problems.length === 0) console.log(`State chart file: ${charts.join(", ")}.`)
  return problems
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
  const [modelProblems, chartProblems] = await Promise.all([
    checkModel(record),
    checkChart(repositoryRoot, record),
  ])
  return [...problems, ...modelProblems, ...chartProblems]
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
