// Line-based comment extraction. Each function maps source text to lines of
// the same length where only comment prose keeps its characters, so line and
// column positions in the output match the original file.

export function extractSlashComments(text: string): string[] {
  let inBlock = false
  let quote: string | null = null

  return text.split("\n").map((line) => {
    const out = new Array<string>(line.length).fill(" ")
    let i = 0

    if (inBlock) {
      while (line[i] === " " || line[i] === "\t") i++
      if (line[i] === "*" && line[i + 1] !== "/") i++
    }

    while (i < line.length) {
      const ch = line[i]
      const next = line[i + 1]
      if (inBlock) {
        if (ch === "*" && next === "/") {
          inBlock = false
          i += 2
          continue
        }
        out[i] = ch as string
        i++
        continue
      }
      if (quote !== null) {
        if (ch === "\\") {
          i += 2
          continue
        }
        if (ch === quote) quote = null
        i++
        continue
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch
        i++
        continue
      }
      if (ch === "/" && next === "/") {
        i += 2
        while (line[i] === "/" || line[i] === "!") i++
        for (; i < line.length; i++) out[i] = line[i] as string
        break
      }
      if (ch === "/" && next === "*") {
        inBlock = true
        i += 2
        while (line[i] === "*" && line[i + 1] !== "/") i++
        continue
      }
      i++
    }
    return out.join("")
  })
}

export function extractHashComments(text: string): string[] {
  let quote: string | null = null

  return text.split("\n").map((line, index) => {
    if (index === 0 && line.startsWith("#!")) {
      return " ".repeat(line.length)
    }
    const out = new Array<string>(line.length).fill(" ")
    let i = 0
    while (i < line.length) {
      const ch = line[i] as string
      if (quote !== null) {
        if (ch === "\\") {
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
      if (ch === '"' || ch === "'") {
        quote = line.startsWith(ch.repeat(3), i) ? ch.repeat(3) : ch
        i += quote.length
        continue
      }
      if (ch === "#" && (i === 0 || /\s/.test(line[i - 1] as string))) {
        let j = i + 1
        while (line[j] === "#") j++
        for (; j < line.length; j++) out[j] = line[j] as string
        break
      }
      i++
    }
    return out.join("")
  })
}
