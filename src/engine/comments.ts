export interface ExtractedComments {
  readonly lines: readonly string[]
  readonly contentStarts: readonly number[]
}

const blankLine = (line: string): string => " ".repeat(line.length)

const consumeSeparator = (line: string, index: number): number =>
  line[index] === " " || line[index] === "\t" ? index + 1 : index

const isRustLifetime = (line: string, index: number): boolean => {
  if (line[index] !== "'" || !/[A-Za-z_]/.test(line[index + 1] ?? "")) return false
  let end = index + 2
  while (/[A-Za-z0-9_]/.test(line[end] ?? "")) end++
  return line[end] !== "'"
}

export function extractSlashComments(text: string): ExtractedComments {
  let inBlock = false
  let multilineQuote: "`" | '"""' | null = null
  const contentStarts: number[] = []

  const lines = text.split("\n").map((line) => {
    const out = new Array<string>(line.length).fill(" ")
    let contentStart = line.length
    let lineQuote: "'" | '"' | null = null
    let i = 0

    const markContentStart = (index: number) => {
      contentStart = Math.min(contentStart, index)
    }

    if (inBlock) {
      while (line[i] === " " || line[i] === "\t") i++
      if (line[i] === "*" && line[i + 1] !== "/") i++
      i = consumeSeparator(line, i)
      markContentStart(i)
    }

    while (i < line.length) {
      const ch = line[i] as string
      const next = line[i + 1]

      if (inBlock) {
        if (ch === "*" && next === "/") {
          inBlock = false
          i += 2
          continue
        }
        out[i] = ch
        i++
        continue
      }

      if (multilineQuote !== null) {
        if (multilineQuote === "`" && ch === "\\") {
          i += 2
          continue
        }
        if (line.startsWith(multilineQuote, i)) {
          i += multilineQuote.length
          multilineQuote = null
          continue
        }
        i++
        continue
      }

      if (lineQuote !== null) {
        if (ch === "\\") {
          i += 2
          continue
        }
        if (ch === lineQuote) lineQuote = null
        i++
        continue
      }

      if (line.startsWith('"""', i)) {
        multilineQuote = '"""'
        i += 3
        continue
      }
      if (ch === "`") {
        multilineQuote = "`"
        i++
        continue
      }
      if (ch === '"' || (ch === "'" && !isRustLifetime(line, i))) {
        lineQuote = ch
        i++
        continue
      }
      if (ch === "/" && next === "/") {
        i += 2
        while (line[i] === "/" || line[i] === "!") i++
        i = consumeSeparator(line, i)
        markContentStart(i)
        for (; i < line.length; i++) out[i] = line[i] as string
        break
      }
      if (ch === "/" && next === "*") {
        inBlock = true
        i += 2
        while (line[i] === "*" && line[i + 1] !== "/") i++
        i = consumeSeparator(line, i)
        markContentStart(i)
        continue
      }
      i++
    }

    contentStarts.push(contentStart)
    return out.join("")
  })

  return { lines, contentStarts }
}

interface Heredoc {
  readonly delimiter: string
  readonly stripTabs: boolean
}

const HEREDOC = /^<<(-)?[ \t]*(?:'([^']+)'|"([^"]+)"|\\([A-Za-z_][\w]*)|([A-Za-z_][\w]*))/

export function extractHashComments(text: string): ExtractedComments {
  let quote: "'" | '"' | "'''" | '"""' | null = null
  let parameterDepth = 0
  let arithmeticDepth = 0
  const heredocs: Heredoc[] = []
  const contentStarts: number[] = []

  const lines = text.split("\n").map((line, lineIndex) => {
    const activeHeredoc = heredocs[0]
    if (activeHeredoc !== undefined) {
      const candidate = activeHeredoc.stripTabs ? line.replace(/^\t+/, "") : line
      if (candidate === activeHeredoc.delimiter) heredocs.shift()
      contentStarts.push(line.length)
      return blankLine(line)
    }

    if (lineIndex === 0 && line.startsWith("#!")) {
      contentStarts.push(line.length)
      return blankLine(line)
    }

    const out = new Array<string>(line.length).fill(" ")
    const pendingHeredocs: Heredoc[] = []
    let contentStart = line.length
    let i = 0

    while (i < line.length) {
      const ch = line[i] as string

      if (quote !== null) {
        if (ch === "\\" && quote !== "'") {
          i += 2
          continue
        }
        if (quote === "'" && line.startsWith("''", i)) {
          i += 2
          continue
        }
        if (line.startsWith(quote, i)) {
          i += quote.length
          quote = null
          continue
        }
        i++
        continue
      }

      if (line.startsWith("'''", i) || line.startsWith('"""', i)) {
        quote = line.slice(i, i + 3) as "'''" | '"""'
        i += 3
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        i++
        continue
      }
      if (line.startsWith("${", i)) {
        parameterDepth++
        i += 2
        continue
      }
      if (parameterDepth > 0 && ch === "}") {
        parameterDepth--
        i++
        continue
      }
      if (line.startsWith("$((", i)) {
        arithmeticDepth++
        i += 3
        continue
      }
      if (arithmeticDepth > 0 && line.startsWith("))", i)) {
        arithmeticDepth--
        i += 2
        continue
      }
      if (parameterDepth === 0 && arithmeticDepth === 0 && line.startsWith("<<", i)) {
        if (line[i + 2] !== "<") {
          const match = line.slice(i).match(HEREDOC)
          if (match !== null) {
            pendingHeredocs.push({
              delimiter: (match[2] ?? match[3] ?? match[4] ?? match[5]) as string,
              stripTabs: match[1] !== undefined,
            })
            i += match[0].length
            continue
          }
        }
      }
      if (
        ch === "#" &&
        parameterDepth === 0 &&
        arithmeticDepth === 0 &&
        line[i - 1] !== "$"
      ) {
        let j = i + 1
        while (line[j] === "#") j++
        j = consumeSeparator(line, j)
        contentStart = j
        for (; j < line.length; j++) out[j] = line[j] as string
        break
      }
      i++
    }

    heredocs.push(...pendingHeredocs)
    contentStarts.push(contentStart)
    return out.join("")
  })

  return { lines, contentStarts }
}
