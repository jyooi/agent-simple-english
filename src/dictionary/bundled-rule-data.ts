import adjectivalParticiples from "./data/adjectival-participles.json" with { type: "json" }
import hedging from "./data/hedging.json" with { type: "json" }
import marketing from "./data/marketing.json" with { type: "json" }
import phrasalVerbs from "./data/phrasal-verbs.json" with { type: "json" }
import type { RuleData } from "./rule-data.ts"
import { decodeDictionaryData } from "./schema.ts"

// Jiti adds a non-enumerable default property that strict schema validation rejects.
const decodeBundledDictionary = (data: object) => decodeDictionaryData({ ...data })

export const BUNDLED_RULE_DATA: RuleData = {
  "phrasal-verb": decodeBundledDictionary(phrasalVerbs),
  hedging: decodeBundledDictionary(hedging),
  marketing: decodeBundledDictionary(marketing),
  "adjectival-participle": decodeBundledDictionary(adjectivalParticiples),
}
