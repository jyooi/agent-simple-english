// Line-based comment extraction. Each function maps source text to lines of
// the same length where only comment prose keeps its characters, so line and
// column positions in the output match the original file. String-literal
// state never carries across lines; that limit is pinned by tests.

export function extractSlashComments(text: string): string[] {
  let inBlock = false
  return text.split("\n").map((line) => {
    const out = new Array<string>(line.length).fill(" ")
    let i = 0
    let quote: string | null = null

    if (inBlock) {
      // Skip the decorative leading asterisk of doc comment continuation lines.
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
  return text.split("\n").map((line, index) => {
    if (index === 0 && line.startsWith("#!")) {
      return ""
    }
    const out = new Array<string>(line.length).fill(" ")
    let quote: string | null = null
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quote !== null) {
        if (ch === "\\") {
          i++
          continue
        }
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }
      if (ch === "#") {
        let j = i + 1
        while (line[j] === "#") j++
        for (; j < line.length; j++) out[j] = line[j] as string
        break
      }
    }
    return out.join("")
  })
}
