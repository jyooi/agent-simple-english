interface WordToken {
  readonly type: "word"
  readonly value: string
  readonly dynamic: boolean
}

interface OperatorToken {
  readonly type: "operator"
}

type ShellToken = WordToken | OperatorToken

export type CommitInvocation =
  | { readonly message: string; readonly requiresExplicitMessage: false }
  | { readonly requiresExplicitMessage: true }

function ansiEscape(character: string): string {
  const escapes: Readonly<Record<string, string>> = {
    "0": "\0",
    a: "\x07",
    b: "\b",
    e: "\x1b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    "\\": "\\",
    "'": "'",
    '"': '"',
  }
  return escapes[character] ?? character
}

function tokenize(command: string): ShellToken[] {
  const tokens: ShellToken[] = []
  let value = ""
  let dynamic = false
  let started = false
  let index = 0

  const flush = () => {
    if (!started) return
    tokens.push({ type: "word", value, dynamic })
    value = ""
    dynamic = false
    started = false
  }

  const operator = (width = 1) => {
    flush()
    tokens.push({ type: "operator" })
    index += width
  }

  while (index < command.length) {
    const character = command[index] ?? ""

    if (/[^\S\r\n]/u.test(character) || character === "\r") {
      flush()
      index++
      continue
    }
    if (character === "\n") {
      operator()
      continue
    }
    if (character === ";" || character === "(" || character === ")") {
      operator()
      continue
    }
    if (character === "&" || character === "|") {
      operator(command[index + 1] === character ? 2 : 1)
      continue
    }
    if (character === "#" && !started) {
      while (index < command.length && command[index] !== "\n") index++
      continue
    }
    if (character === "\\") {
      started = true
      const next = command[index + 1]
      if (next === "\n") {
        index += 2
      } else if (next === undefined) {
        value += "\\"
        index++
      } else {
        value += next
        index += 2
      }
      continue
    }
    if (character === "'") {
      started = true
      index++
      while (index < command.length && command[index] !== "'") {
        value += command[index]
        index++
      }
      if (command[index] === "'") index++
      continue
    }
    if (character === '"') {
      started = true
      index++
      while (index < command.length && command[index] !== '"') {
        const quoted = command[index] ?? ""
        if (quoted === "\\") {
          const next = command[index + 1]
          if (next === "\n") {
            index += 2
            continue
          }
          if (next === "$" || next === "`" || next === '"' || next === "\\") {
            value += next
            index += 2
            continue
          }
          value += "\\"
          index++
          continue
        }
        if (quoted === "$" || quoted === "`") dynamic = true
        value += quoted
        index++
      }
      if (command[index] === '"') index++
      continue
    }
    if (character === "$" && command[index + 1] === "'") {
      started = true
      index += 2
      while (index < command.length && command[index] !== "'") {
        const quoted = command[index] ?? ""
        if (quoted === "\\" && command[index + 1] !== undefined) {
          value += ansiEscape(command[index + 1] ?? "")
          index += 2
        } else {
          value += quoted
          index++
        }
      }
      if (command[index] === "'") index++
      continue
    }
    if (character === "$" || character === "`") dynamic = true
    started = true
    value += character
    index++
  }

  flush()
  return tokens
}

function commandSegments(tokens: readonly ShellToken[]): WordToken[][] {
  const segments: WordToken[][] = []
  let segment: WordToken[] = []
  for (const token of tokens) {
    if (token.type === "operator") {
      if (segment.length > 0) segments.push(segment)
      segment = []
    } else {
      segment.push(token)
    }
  }
  if (segment.length > 0) segments.push(segment)
  return segments
}

function executableName(value: string): string {
  return value.slice(Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1)
}

function gitCommandIndex(segment: readonly WordToken[]): number | undefined {
  let index = 0
  if (segment[index]?.value === "command") {
    index++
    while (segment[index]?.value.startsWith("-")) index++
  }
  if (segment[index]?.value === "env") {
    index++
    while (segment[index]) {
      const argument = segment[index]
      if (
        argument === undefined ||
        (!argument.value.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(argument.value))
      ) {
        break
      }
      index++
    }
  }
  while (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(segment[index]?.value ?? "")) index++
  return executableName(segment[index]?.value ?? "") === "git" ? index : undefined
}

function commitSubcommandIndex(
  segment: readonly WordToken[],
  gitIndex: number,
): number | undefined {
  for (let index = gitIndex + 1; index < segment.length; index++) {
    const argument = segment[index]?.value ?? ""
    if (argument === "commit") return index
    if (!argument.startsWith("-")) return undefined
    if (
      ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"].includes(argument)
    ) {
      index++
    }
  }
  return undefined
}

function invocation(segment: readonly WordToken[]): CommitInvocation | undefined {
  const gitIndex = gitCommandIndex(segment)
  if (gitIndex === undefined) return undefined
  const commitIndex = commitSubcommandIndex(segment, gitIndex)
  if (commitIndex === undefined) return undefined

  const messageParts: string[] = []
  let messageIsDynamic = false

  for (let index = commitIndex + 1; index < segment.length; index++) {
    const argument = segment[index]
    if (argument === undefined) continue
    if (argument.value === "-m" || argument.value === "--message") {
      const message = segment[++index]
      if (message === undefined) return { requiresExplicitMessage: true }
      messageParts.push(message.value)
      messageIsDynamic ||= message.dynamic
      continue
    }
    if (argument.value.startsWith("--message=")) {
      messageParts.push(argument.value.slice("--message=".length))
      messageIsDynamic ||= argument.dynamic
      continue
    }
    const shortMessage = argument.value.match(/^-[A-Za-z]*?m(.*)$/u)
    if (shortMessage !== null) {
      const attached = shortMessage[1] ?? ""
      if (attached.length > 0) {
        messageParts.push(attached)
        messageIsDynamic ||= argument.dynamic
      } else {
        const message = segment[++index]
        if (message === undefined) return { requiresExplicitMessage: true }
        messageParts.push(message.value)
        messageIsDynamic ||= message.dynamic
      }
    }
  }

  if (messageParts.length > 0) {
    return messageIsDynamic
      ? { requiresExplicitMessage: true }
      : { message: messageParts.join("\n\n"), requiresExplicitMessage: false }
  }
  return { requiresExplicitMessage: true }
}

export function findCommitInvocations(command: string): readonly CommitInvocation[] {
  return commandSegments(tokenize(command)).flatMap((segment) => {
    const found = invocation(segment)
    return found === undefined ? [] : [found]
  })
}

function blankLine(line: string): string {
  return " ".repeat(line.length)
}

export function blankCommitMetadata(message: string): string {
  const lines = message.split("\n")
  const prefix = lines[0]?.match(/^[A-Za-z][A-Za-z0-9-]*(?:\([^\r\n)]*\))?!?:[\t ]*/u)?.[0]
  if (prefix !== undefined && lines[0] !== undefined) {
    lines[0] = `:${" ".repeat(Math.max(prefix.length - 1, 0))}${lines[0].slice(prefix.length)}`
  }

  let trailerEnd = lines.length - 1
  while (trailerEnd > 0 && !/\S/u.test(lines[trailerEnd] ?? "")) trailerEnd--
  let trailerStart = trailerEnd + 1
  let hasTrailer = false
  for (let index = trailerEnd; index > 0; index--) {
    const line = lines[index] ?? ""
    if (/^(?:[A-Za-z0-9][A-Za-z0-9-]*|BREAKING CHANGE)[\t ]*(?::| #)[\t ]+\S/u.test(line)) {
      hasTrailer = true
      trailerStart = index
      continue
    }
    if (/^[\t ]+\S/u.test(line)) {
      trailerStart = index
      continue
    }
    break
  }
  if (hasTrailer) {
    for (let index = trailerStart; index <= trailerEnd; index++) {
      lines[index] = blankLine(lines[index] ?? "")
    }
  }

  return lines.join("\n")
}
