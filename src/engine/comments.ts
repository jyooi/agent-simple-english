import type { SourceDialect } from "./types.ts"

export interface ExtractedComments {
  readonly lines: readonly string[]
  readonly contentStarts: readonly number[]
}

const blankLine = (line: string): string => " ".repeat(line.length)

const consumeSeparator = (line: string, index: number): number =>
  line[index] === " " || line[index] === "\t" ? index + 1 : index

const hasEscapedLineBreak = (line: string): boolean => {
  let index = line.endsWith("\r") ? line.length - 1 : line.length
  let backslashes = 0
  while (line[index - 1] === "\\") {
    backslashes++
    index--
  }
  return backslashes % 2 !== 0
}

const isRustLifetime = (line: string, index: number): boolean => {
  if (line[index] !== "'" || !/[A-Za-z_]/.test(line[index + 1] ?? "")) return false
  let end = index + 2
  while (/[A-Za-z0-9_]/.test(line[end] ?? "")) end++
  return line[end] !== "'"
}

type MultilineLiteral =
  | { readonly kind: "escaped"; readonly terminator: string }
  | { readonly kind: "literal"; readonly terminator: string }
  | { readonly kind: "verbatim" }

const hasTokenBoundary = (line: string, index: number): boolean =>
  index === 0 || !/[A-Za-z0-9_]/.test(line[index - 1] ?? "")

const multilineLiteralAt = (
  line: string,
  index: number,
): { literal: MultilineLiteral; end: number } | null => {
  if (!hasTokenBoundary(line, index)) return null

  const csharp = line.slice(index).match(/^(?:\$@|@\$|@)"/)
  if (csharp !== null) {
    return { literal: { kind: "verbatim" }, end: index + csharp[0].length }
  }

  const rust = line.slice(index).match(/^(?:br|r)(#{0,255})"/)
  if (rust !== null) {
    return {
      literal: { kind: "literal", terminator: `"${rust[1] as string}` },
      end: index + rust[0].length,
    }
  }

  const cpp = line.slice(index).match(/^(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\(/)
  if (cpp !== null) {
    return {
      literal: { kind: "literal", terminator: `)${cpp[1] as string}"` },
      end: index + cpp[0].length,
    }
  }

  return null
}

export function extractSlashComments(text: string): ExtractedComments {
  let inBlock = false
  let multilineLiteral: MultilineLiteral | null = null
  let continuedLineQuote: "'" | '"' | null = null
  const contentStarts: number[] = []

  const lines = text.split("\n").map((line) => {
    const out = new Array<string>(line.length).fill(" ")
    let contentStart = line.length
    let lineQuote = continuedLineQuote
    continuedLineQuote = null
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

      if (multilineLiteral !== null) {
        if (multilineLiteral.kind === "escaped" && ch === "\\") {
          i += 2
          continue
        }
        if (multilineLiteral.kind === "verbatim") {
          if (line.startsWith('""', i)) {
            i += 2
            continue
          }
          if (ch === '"') {
            multilineLiteral = null
            i++
            continue
          }
          i++
          continue
        }
        if (line.startsWith(multilineLiteral.terminator, i)) {
          i += multilineLiteral.terminator.length
          multilineLiteral = null
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

      const boundedLiteral = multilineLiteralAt(line, i)
      if (boundedLiteral !== null) {
        multilineLiteral = boundedLiteral.literal
        i = boundedLiteral.end
        continue
      }
      if (line.startsWith('"""', i)) {
        multilineLiteral = { kind: "literal", terminator: '"""' }
        i += 3
        continue
      }
      if (ch === "`") {
        multilineLiteral = { kind: "escaped", terminator: "`" }
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

    if (lineQuote !== null && hasEscapedLineBreak(line)) continuedLineQuote = lineQuote
    contentStarts.push(contentStart)
    return out.join("")
  })

  return { lines, contentStarts }
}

interface Heredoc {
  readonly delimiter: string
  readonly stripTabs: boolean
}

interface ParsedHeredoc extends Heredoc {
  readonly end: number
}

const parseHeredoc = (line: string, start: number): ParsedHeredoc | null => {
  if (!line.startsWith("<<", start) || line[start + 2] === "<") return null
  let index = start + 2
  let stripTabs = false
  if (line[index] === "-") {
    stripTabs = true
    index++
  }
  while (line[index] === " " || line[index] === "\t") index++

  let delimiter = ""
  while (index < line.length && !/[\s;&|()<>]/.test(line[index] as string)) {
    const ch = line[index] as string
    if (ch === "'" || ch === '"') {
      const quote = ch
      const close = line.indexOf(quote, index + 1)
      if (close === -1) return null
      delimiter += line.slice(index + 1, close)
      index = close + 1
      continue
    }
    if (ch === "\\") {
      if (index + 1 >= line.length) return null
      delimiter += line[index + 1] as string
      index += 2
      continue
    }
    delimiter += ch
    index++
  }

  return delimiter === "" ? null : { delimiter, stripTabs, end: index }
}

const isShellCommentStart = (line: string, index: number): boolean =>
  index === 0 || /[\s;|&()]/.test(line[index - 1] ?? "")

export function extractHashComments(
  text: string,
  dialect: SourceDialect = "general",
): ExtractedComments {
  let multilineQuote: "'''" | '"""' | null = null
  let shellQuote: "'" | '"' | null = null
  let continuedLineQuote: "'" | '"' | null = null
  let parameterDepth = 0
  let arithmeticDepth = 0
  const heredocs: Heredoc[] = []
  const contentStarts: number[] = []
  const shell = dialect === "shell"

  const lines = text.split("\n").map((line, lineIndex) => {
    const activeHeredoc = heredocs[0]
    if (activeHeredoc !== undefined) {
      const normalized = line.endsWith("\r") ? line.slice(0, -1) : line
      const candidate = activeHeredoc.stripTabs ? normalized.replace(/^\t+/, "") : normalized
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
    let lineQuote = continuedLineQuote
    continuedLineQuote = null
    let i = 0

    while (i < line.length) {
      const ch = line[i] as string

      if (multilineQuote !== null) {
        if (line.startsWith(multilineQuote, i)) {
          i += multilineQuote.length
          multilineQuote = null
          continue
        }
        i++
        continue
      }

      if (shellQuote !== null) {
        if (ch === "\\" && shellQuote === '"') {
          i += 2
          continue
        }
        if (ch === shellQuote) shellQuote = null
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

      if (!shell && (line.startsWith("'''", i) || line.startsWith('"""', i))) {
        multilineQuote = line.slice(i, i + 3) as "'''" | '"""'
        i += 3
        continue
      }
      if (ch === '"' || ch === "'") {
        if (shell) shellQuote = ch
        else lineQuote = ch
        i++
        continue
      }
      if (shell && line.startsWith("${", i)) {
        parameterDepth++
        i += 2
        continue
      }
      if (shell && parameterDepth > 0 && ch === "}") {
        parameterDepth--
        i++
        continue
      }
      if (shell && line.startsWith("$((", i)) {
        arithmeticDepth++
        i += 3
        continue
      }
      if (shell && arithmeticDepth > 0 && line.startsWith("))", i)) {
        arithmeticDepth--
        i += 2
        continue
      }
      if (shell && parameterDepth === 0 && arithmeticDepth === 0 && line.startsWith("<<", i)) {
        const heredoc = parseHeredoc(line, i)
        if (heredoc !== null) {
          pendingHeredocs.push({ delimiter: heredoc.delimiter, stripTabs: heredoc.stripTabs })
          i = heredoc.end
          continue
        }
      }
      if (
        ch === "#" &&
        parameterDepth === 0 &&
        arithmeticDepth === 0 &&
        line[i - 1] !== "$" &&
        (!shell || isShellCommentStart(line, i))
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

    if (lineQuote !== null && hasEscapedLineBreak(line)) continuedLineQuote = lineQuote
    heredocs.push(...pendingHeredocs)
    contentStarts.push(contentStart)
    return out.join("")
  })

  return { lines, contentStarts }
}
