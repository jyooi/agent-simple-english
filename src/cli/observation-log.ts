import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { createInterface } from "node:readline"
import type { LintKind, ReportViolation } from "../engine/types.ts"
import { applicationStateDirectory } from "./state-directory.ts"

export type ObservationEvent = "write" | "edit" | "commit-message" | "reply"
export type ObservationDecision = "allow" | "deny"
export type VerdictValue = "true-positive" | "false-positive"

export interface ObservationFinding {
  readonly index: number
  readonly ruleId: string
  readonly severity: "hard" | "soft"
  readonly message: string
  readonly snippet: string
  readonly line: number
  readonly column: number
}

export interface Observation {
  readonly id: string
  readonly at: string
  readonly surface: "claude-code-hook"
  readonly event: ObservationEvent
  readonly sessionId: string
  readonly cwd: string
  readonly path?: string
  readonly kind: LintKind
  readonly decision: ObservationDecision
  readonly textHash: string
  readonly findings: readonly ObservationFinding[]
}

export interface Verdict {
  readonly at: string
  readonly observationId: string
  readonly findingIndex: number
  readonly verdict: VerdictValue
  readonly note?: string
}

export interface ObservationDraft {
  readonly event: ObservationEvent
  readonly sessionId: string
  readonly cwd: string
  readonly path?: string
  readonly kind: LintKind
  readonly decision: ObservationDecision
  readonly text: string
  readonly violations: readonly ReportViolation[]
}

const observationsDirectory = (): string => join(applicationStateDirectory(), "observations")

const verdictsPath = (): string => join(applicationStateDirectory(), "verdicts.jsonl")

function isFileError(cause: unknown, code: string): boolean {
  return (
    typeof cause === "object" && cause !== null && (cause as NodeJS.ErrnoException).code === code
  )
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(applicationStateDirectory(), { recursive: true, mode: 0o700 })
  const file = await open(path, "a", 0o600)
  try {
    await file.write(`${JSON.stringify(value)}\n`)
  } finally {
    await file.close()
  }
}

export async function appendObservation(draft: ObservationDraft): Promise<void> {
  if (process.env.SIMPLE_ENGLISH_OBSERVE === "0") return
  const at = new Date().toISOString()
  const directory = observationsDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const observation: Observation = {
    id: randomUUID(),
    at,
    surface: "claude-code-hook",
    event: draft.event,
    sessionId: draft.sessionId,
    cwd: draft.cwd,
    ...(draft.path === undefined ? {} : { path: draft.path }),
    kind: draft.kind,
    decision: draft.decision,
    textHash: `sha256:${createHash("sha256").update(draft.text).digest("hex")}`,
    findings: draft.violations.map((violation, index) => ({
      index,
      ruleId: violation.ruleId,
      severity: violation.severity,
      message: violation.message,
      snippet: violation.snippet,
      line: violation.line,
      column: violation.column,
    })),
  }
  await appendJsonLine(join(directory, `${at.slice(0, 7)}.jsonl`), observation)
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (cause) {
    if (isFileError(cause, "ENOENT")) return []
    throw cause
  }
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line) as T
      } catch (cause) {
        throw new Error(`invalid JSON on line ${index + 1} of ${path}: ${cause}`)
      }
    })
}

async function readObservations(): Promise<Observation[]> {
  let files: string[]
  try {
    files = await readdir(observationsDirectory())
  } catch (cause) {
    if (isFileError(cause, "ENOENT")) return []
    throw cause
  }
  const monthlyFiles = files.filter((file) => /^\d{4}-\d{2}\.jsonl$/u.test(file)).sort()
  const records = await Promise.all(
    monthlyFiles.map((file) => readJsonLines<Observation>(join(observationsDirectory(), file))),
  )
  return records.flat()
}

const findingKey = (observationId: string, findingIndex: number): string =>
  `${observationId}\u0000${findingIndex}`

async function latestVerdicts(): Promise<Map<string, Verdict>> {
  const verdicts = await readJsonLines<Verdict>(verdictsPath())
  return new Map(
    verdicts.map((verdict) => [findingKey(verdict.observationId, verdict.findingIndex), verdict]),
  )
}

async function appendVerdict(verdict: Verdict): Promise<void> {
  await appendJsonLine(verdictsPath(), verdict)
}

function write(text: string): void {
  process.stdout.write(text)
}

export async function reviewObservations(): Promise<void> {
  const observations = await readObservations()
  const verdicts = await latestVerdicts()
  const unjudged = observations.flatMap((observation) =>
    observation.findings.flatMap((finding) =>
      verdicts.has(findingKey(observation.id, finding.index)) ? [] : [{ observation, finding }],
    ),
  )
  if (unjudged.length === 0) {
    write("No unjudged findings.\n")
    return
  }

  const input = createInterface({ input: process.stdin, output: process.stdout })
  const lines = input[Symbol.asyncIterator]()
  let recorded = 0
  try {
    for (const { observation, finding } of unjudged) {
      const location = observation.path ?? "assistant reply"
      write(
        `\n[${finding.ruleId}] ${finding.severity} at ${location}:${finding.line}:${finding.column}\n${finding.snippet}\n${finding.message}\n`,
      )
      let choice: string | undefined
      while (choice === undefined) {
        write("Verdict [t]rue, [f]alse, [s]kip, [q]uit: ")
        const next = await lines.next()
        if (next.done) return
        const answer = next.value.trim().toLowerCase()
        if (answer === "q" || answer === "quit") return
        if (answer === "s" || answer === "skip") {
          choice = "skip"
        } else if (answer === "t" || answer === "true" || answer === "true-positive") {
          choice = "true-positive"
        } else if (answer === "f" || answer === "false" || answer === "false-positive") {
          choice = "false-positive"
        }
      }
      if (choice === "skip") continue

      write("Note (optional): ")
      const noteLine = await lines.next()
      const note = noteLine.done ? "" : noteLine.value.trim()
      await appendVerdict({
        at: new Date().toISOString(),
        observationId: observation.id,
        findingIndex: finding.index,
        verdict: choice as VerdictValue,
        ...(note === "" ? {} : { note }),
      })
      recorded += 1
      if (noteLine.done) return
    }
  } finally {
    input.close()
    write(`\nRecorded ${recorded} verdict${recorded === 1 ? "" : "s"}.\n`)
  }
}

interface RuleStats {
  fires: number
  judged: number
  falsePositives: number
}

export async function observationStats(): Promise<string> {
  const observations = await readObservations()
  const verdicts = await latestVerdicts()
  const stats = new Map<string, RuleStats>()

  for (const observation of observations) {
    for (const finding of observation.findings) {
      const rule = stats.get(finding.ruleId) ?? { fires: 0, judged: 0, falsePositives: 0 }
      rule.fires += 1
      const verdict = verdicts.get(findingKey(observation.id, finding.index))
      if (verdict !== undefined) {
        rule.judged += 1
        if (verdict.verdict === "false-positive") rule.falsePositives += 1
      }
      stats.set(finding.ruleId, rule)
    }
  }

  const cleanAllows = observations.filter(
    (observation) => observation.decision === "allow" && observation.findings.length === 0,
  ).length
  const ruleIds = [...stats.keys()].sort()
  const ruleWidth = Math.max("Rule".length, ...ruleIds.map((ruleId) => ruleId.length))
  const rows = ruleIds.map((ruleId) => {
    const rule = stats.get(ruleId) as RuleStats
    const rate =
      rule.judged === 0 ? "-" : `${((rule.falsePositives / rule.judged) * 100).toFixed(1)}%`
    return `${ruleId.padEnd(ruleWidth)}  ${String(rule.fires).padStart(5)}  ${String(rule.judged).padStart(6)}  ${rate}`
  })
  return [
    `Observations: ${observations.length}`,
    `Clean allows: ${cleanAllows}`,
    "",
    `${"Rule".padEnd(ruleWidth)}  Fires  Judged  False-positive rate`,
    ...rows,
  ].join("\n")
}
