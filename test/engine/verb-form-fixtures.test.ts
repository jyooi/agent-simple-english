import { describe, expect, test } from "vitest"
import { lint } from "../../src/engine/lint.ts"
import { makeWinkTagger } from "../../src/tagger/wink.ts"

// Fixture suite against the real wink-nlp tagger. Each entry pins the accepted
// verdict, right or wrong, so tagger or rule changes surface as diffs here.
const tagger = makeWinkTagger()

const ruleIds = (text: string) =>
  lint("prose-file", text, { tagger }).violations.map((violation) => violation.ruleId)

interface Fixture {
  readonly text: string
  readonly expected: readonly string[]
  readonly note?: string
}

const passives: readonly Fixture[] = [
  { text: "The bolt was removed by the technician.", expected: ["verb-passive"] },
  { text: "The cables are connected to the panel.", expected: ["verb-passive"] },
  { text: "The filter must be replaced every month.", expected: ["verb-passive"] },
  { text: "The window was broken.", expected: ["verb-passive"] },
  { text: "The report was written by the engineer.", expected: ["verb-passive"] },
  { text: "The parts were taken from the shelf.", expected: ["verb-passive"] },
  { text: "The instructions are given in chapter two.", expected: ["verb-passive"] },
  { text: "The results were not shown.", expected: ["verb-passive"] },
  { text: "The valve was quickly closed by the operator.", expected: ["verb-passive"] },
]

const actives: readonly Fixture[] = [
  { text: "The technician removes the bolt.", expected: [] },
  { text: "Remove the bolt.", expected: [] },
  { text: "The pump supplies fuel to the engine.", expected: [] },
  { text: "The team completed the test.", expected: [] },
  { text: "The engineer wrote the report.", expected: [] },
  { text: "Turn the handle to the left.", expected: [] },
]

const progressives: readonly Fixture[] = [
  { text: "The pump is running.", expected: ["verb-progressive"] },
  { text: "The technicians were installing the pump.", expected: ["verb-progressive"] },
  { text: "The light is flashing quickly.", expected: ["verb-progressive"] },
]

const perfects: readonly Fixture[] = [
  { text: "The technician has finished the task.", expected: ["verb-perfect"] },
  { text: "The team had completed the test before the review.", expected: ["verb-perfect"] },
  { text: "We have removed the old filter.", expected: ["verb-perfect"] },
]

const tricky: readonly Fixture[] = [
  {
    text: "The door is closed.",
    expected: ["verb-passive"],
    note: "adjectival state, accepted false positive; the pi-ste reference flags it too",
  },
  {
    text: "The system is being tested.",
    expected: ["verb-passive"],
    note: "passive progressive; wink tags 'being' AUX, so only the passive fires",
  },
  {
    text: "The report has been sent.",
    expected: ["verb-passive"],
    note: "perfect passive reported as passive only, mirroring the pi-ste reference",
  },
  {
    text: "The goal is to win.",
    expected: [],
    note: "infinitive after a linking verb is not a participle",
  },
  {
    text: "The equipment is ready.",
    expected: [],
    note: "plain adjective predicate",
  },
  {
    text: "The manual is interesting.",
    expected: [],
    note: "wink tags 'interesting' ADJ; the pi-ste regex wrongly flags this as progressive",
  },
  {
    text: "The technicians have the tools.",
    expected: [],
    note: "main-verb have is not a perfect auxiliary",
  },
]

const suites: readonly [string, readonly Fixture[]][] = [
  ["passive voice", passives],
  ["active voice", actives],
  ["progressive tense", progressives],
  ["perfect tense", perfects],
  ["tricky pinned verdicts", tricky],
]

describe("verb-form rules against the real wink-nlp tagger", () => {
  for (const [name, fixtures] of suites) {
    describe(name, () => {
      for (const fixture of fixtures) {
        test(`"${fixture.text}" -> [${fixture.expected.join(", ")}]`, () => {
          expect(ruleIds(fixture.text)).toEqual(fixture.expected)
        })
      }
    })
  }

  test("verdicts are deterministic across repeated runs", () => {
    const text = "The bolt was removed by the technician."
    const first = lint("prose-file", text, { tagger })
    const second = lint("prose-file", text, { tagger: makeWinkTagger() })
    expect(second).toEqual(first)
  })
})
