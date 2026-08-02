import hedging from "./data/hedging.json" with { type: "json" }
import marketing from "./data/marketing.json" with { type: "json" }
import phrasalVerbs from "./data/phrasal-verbs.json" with { type: "json" }
import type { RuleData } from "./rule-data.ts"
import { decodeDictionaryData } from "./schema.ts"

export const BUNDLED_RULE_DATA: RuleData = {
  "phrasal-verb": decodeDictionaryData(phrasalVerbs),
  hedging: decodeDictionaryData(hedging),
  marketing: decodeDictionaryData(marketing),
}
