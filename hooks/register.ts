interface Suggestion {
  readonly text: string
  readonly description: string
}

interface AutocompleteInput {
  readonly text: string
  readonly token: string
  readonly start: number
}

interface AutocompleteResult {
  readonly suggestions: readonly Suggestion[]
}

type AutocompleteHook = (
  engine: unknown,
  input: AutocompleteInput,
  next: (input: AutocompleteInput) => Promise<AutocompleteResult>,
) => Promise<AutocompleteResult>

const FIRST_WORDS: readonly Suggestion[] = [
  { text: "on", description: "Enable write, edit, commit, and reply checks" },
  { text: "off", description: "Disable all checks and leave strict mode" },
  { text: "status", description: "Show the mode, rule counts, and dictionary state" },
  { text: "strict", description: "Enable the strict reply gate and all other checks" },
  { text: "explain", description: "Write the last reply again in Simplified Technical English" },
]

const WORDS_AFTER_STRICT: readonly Suggestion[] = [
  { text: "off", description: "Disable the strict reply gate and use reply feedback" },
]

export function aseSuggestions(text: string, token: string, start: number): readonly Suggestion[] {
  const head = /^\/(?:simple-english:)?ase\s+(.*)$/u.exec(text.slice(0, start))
  if (head === null) return []
  const earlierWords = (head[1] ?? "").trim().toLowerCase()
  const words =
    earlierWords === "" ? FIRST_WORDS : earlierWords === "strict" ? WORDS_AFTER_STRICT : []
  const typed = token.toLowerCase()
  return words.filter((word) => word.text.startsWith(typed) && word.text !== typed)
}

export function register(on: (event: "prompt.autocomplete", hook: AutocompleteHook) => void): void {
  on("prompt.autocomplete", async (_engine, input, next) => ({
    suggestions: [
      ...aseSuggestions(input.text, input.token, input.start),
      ...(await next(input)).suggestions,
    ],
  }))
}
