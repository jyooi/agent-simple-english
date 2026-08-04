import type { Dictionary } from "../../dictionary/schema.ts"
import { caseFoldKey } from "../case-fold.ts"
import type { TaggedToken, Tagger } from "../tagger.ts"
import type { Violation } from "../types.ts"

const BE_FORMS = new Set(["am", "is", "are", "was", "were", "be", "been", "being"])

const isBeForm = (token: TaggedToken) => BE_FORMS.has(token.text.toLowerCase())

const isPerfectAuxiliary = (token: TaggedToken) => token.pos === "AUX" && token.lemma === "have"

// Adverbs and "not" may sit between the auxiliary and its verb
// ("was quickly closed", "were not shown") without breaking the construct.
const isSkippable = (token: TaggedToken) =>
  token.pos === "ADV" || token.text.toLowerCase() === "not"

const isProgressiveVerb = (token: TaggedToken) =>
  token.pos === "VERB" && token.text.toLowerCase().endsWith("ing")

// After a be/have auxiliary, any non-"ing" verb is a past participle in
// practice, which covers irregular forms (broken, sent, written) without a list.
const isPastParticiple = (token: TaggedToken) =>
  token.pos === "VERB" && !token.text.toLowerCase().endsWith("ing")

const allowlistByDictionary = new WeakMap<Dictionary, ReadonlySet<string>>()

const allowlistFor = (dictionary: Dictionary): ReadonlySet<string> => {
  const cached = allowlistByDictionary.get(dictionary)
  if (cached !== undefined) return cached

  const allowlist = new Set(
    dictionary.entries.flatMap((entry) => entry.unapproved).map(caseFoldKey),
  )
  allowlistByDictionary.set(dictionary, allowlist)
  return allowlist
}

const isAllowlisted = (token: TaggedToken, dictionary: Dictionary | undefined): boolean =>
  dictionary !== undefined && allowlistFor(dictionary).has(caseFoldKey(token.text))

function nextContentToken(tokens: readonly TaggedToken[], start: number): TaggedToken | undefined {
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i]
    if (token !== undefined && !isSkippable(token)) {
      return token
    }
  }
  return undefined
}

export function verbForm(
  lines: readonly string[],
  tag: Tagger,
  adjectivalParticiples?: Dictionary,
): Violation[] {
  const violations: Violation[] = []

  lines.forEach((line, index) => {
    if (line.trim() === "") {
      return
    }
    const tokens = tag(line)

    tokens.forEach((token, i) => {
      const head = nextContentToken(tokens, i + 1)
      if (head === undefined) {
        return
      }
      const found = line.slice(token.offset, head.offset + head.text.length)
      const position = { line: index + 1, column: token.offset + 1 }
      const allowlisted = isAllowlisted(head, adjectivalParticiples)

      if (isBeForm(token) && isProgressiveVerb(head) && !allowlisted) {
        violations.push({
          ruleId: "verb-progressive",
          severity: "hard",
          message: `Use a simple tense. Do not use the progressive. Found: "${found}".`,
          ...position,
        })
      } else if (isBeForm(token) && isPastParticiple(head) && !allowlisted) {
        violations.push({
          ruleId: "verb-passive",
          severity: "soft",
          message: `Use the active voice, unless the actor is unknown. Found: "${found}".`,
          ...position,
        })
      } else if (isPerfectAuxiliary(token) && isPastParticiple(head)) {
        violations.push({
          ruleId: "verb-perfect",
          severity: "hard",
          message: `Use the simple past. Do not use the perfect tense. Found: "${found}".`,
          ...position,
        })
      }
    })
  })

  return violations
}
