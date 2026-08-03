import {
  asciiAlphanumeric,
  asciiAlpha,
  markdownLineEnding,
  markdownLineEndingOrSpace,
} from "micromark-util-character"
import { htmlRawNames } from "micromark-util-html-tag-name"
import type {
  Code,
  Construct,
  Effects,
  Extension,
  Resolver,
  State,
  TokenizeContext,
  Tokenizer,
} from "micromark-util-types"

declare module "micromark-util-types" {
  interface TokenTypeMap {
    htmlRawFlow: "htmlRawFlow"
    htmlRawFlowData: "htmlRawFlowData"
  }
}

const resolveToRawHtmlFlow: Resolver = (events) => {
  let index = events.length
  while (index > 0) {
    index--
    if (events[index]?.[0] === "enter" && events[index]?.[1].type === "htmlRawFlow") break
  }

  if (index > 1 && events[index - 2]?.[1].type === "linePrefix") {
    const start = events[index - 2]?.[1].start
    if (start !== undefined) {
      const flow = events[index]?.[1]
      const data = events[index + 1]?.[1]
      if (flow !== undefined) flow.start = start
      if (data !== undefined) data.start = start
    }
    events.splice(index - 2, 2)
  }

  return events
}

const nonLazyContinuationStart: Construct = {
  partial: true,
  tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    const self = this

    return (code) => {
      if (!markdownLineEnding(code)) return nok(code)
      effects.enter("lineEnding")
      effects.consume(code)
      effects.exit("lineEnding")
      return (nextCode) => (self.parser.lazy[self.now().line] ? nok(nextCode) : ok(nextCode))
    }
  },
}

const tokenizeRawHtmlFlow: Tokenizer = function (effects, ok, nok) {
  const self = this
  let name = ""

  return start

  function start(code: Code): State | undefined {
    effects.enter("htmlRawFlow")
    effects.enter("htmlRawFlowData")
    effects.consume(code)
    return openingNameStart
  }

  function openingNameStart(code: Code): State | undefined {
    if (!asciiAlpha(code)) return nok(code)
    effects.consume(code)
    name = String.fromCharCode(code ?? 0)
    return openingName
  }

  function openingName(code: Code): State | undefined {
    if (code === 62 || markdownLineEndingOrSpace(code) || code === null) {
      if (!htmlRawNames.includes(name.toLowerCase())) return nok(code)
      return self.interrupt ? ok(code) : continuation(code)
    }
    if (code === 45 || asciiAlphanumeric(code)) {
      effects.consume(code)
      name += String.fromCharCode(code ?? 0)
      return openingName
    }
    return nok(code)
  }

  function continuation(code: Code): State | undefined {
    if (code === 60) {
      effects.consume(code)
      return closingSlash
    }
    if (markdownLineEnding(code) || code === null) {
      effects.exit("htmlRawFlowData")
      return continuationStart(code)
    }
    effects.consume(code)
    return continuation
  }

  function continuationStart(code: Code): State | undefined {
    return effects.check(nonLazyContinuationStart, continuationLineEnding, done)(code)
  }

  function continuationLineEnding(code: Code): State | undefined {
    effects.enter("lineEnding")
    effects.consume(code)
    effects.exit("lineEnding")
    return continuationBefore
  }

  function continuationBefore(code: Code): State | undefined {
    if (markdownLineEnding(code) || code === null) return continuationStart(code)
    effects.enter("htmlRawFlowData")
    return continuation(code)
  }

  function closingSlash(code: Code): State | undefined {
    if (code !== 47) return continuation(code)
    effects.consume(code)
    name = ""
    return closingName
  }

  function closingName(code: Code): State | undefined {
    if (code === 62) {
      if (!htmlRawNames.includes(name.toLowerCase())) return continuation(code)
      effects.consume(code)
      return closingLine
    }
    if (asciiAlpha(code) && name.length < 8) {
      effects.consume(code)
      name += String.fromCharCode(code ?? 0)
      return closingName
    }
    return continuation(code)
  }

  function closingLine(code: Code): State | undefined {
    if (markdownLineEnding(code) || code === null) {
      effects.exit("htmlRawFlowData")
      return done(code)
    }
    effects.consume(code)
    return closingLine
  }

  function done(code: Code): State | undefined {
    effects.exit("htmlRawFlow")
    return ok(code)
  }
}

const rawHtmlFlow: Construct = {
  concrete: true,
  name: "htmlRawFlow",
  resolveTo: resolveToRawHtmlFlow,
  tokenize: tokenizeRawHtmlFlow,
}

export const markdownSyntaxExtension: Extension = {
  flow: { 60: rawHtmlFlow },
}
