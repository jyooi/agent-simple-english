import hedging from "./data/hedging.json" with { type: "json" }
import marketing from "./data/marketing.json" with { type: "json" }
import phrasalVerbs from "./data/phrasal-verbs.json" with { type: "json" }
import type { RuleData } from "./rule-data.ts"
import type { Dictionary } from "./schema.ts"

export const BUNDLED_RULE_DATA: RuleData = {
  "phrasal-verb": phrasalVerbs as unknown as Dictionary,
  hedging: hedging as unknown as Dictionary,
  marketing: marketing as unknown as Dictionary,
}
