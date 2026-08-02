import { describe, expect, test } from "vitest"
import type { ApprovedWordList, Dictionary } from "../../src/dictionary/schema.ts"
import { lint } from "../../src/engine/lint.ts"
import { blankMarkdownDestinations } from "../../src/engine/markdown.ts"
import type { Tagger } from "../../src/engine/tagger.ts"

const dictionary = {
  formatVersion: 1,
  source: {
    name: "test fixture",
    repository: "https://example.test/dictionary",
    commit: "fixture",
    path: "dictionary.json",
  },
  entries: [
    { unapproved: ["attempt", "attempts"], suggestions: ["try"], partsOfSpeech: ["VERB"] },
    { unapproved: ["approximately"], suggestions: ["about"] },
    { unapproved: ["prior to"], suggestions: ["before"] },
    { unapproved: ["in order to"], suggestions: ["to"] },
    { unapproved: ["state-of-the-art"], suggestions: ["advanced"] },
  ],
} as const satisfies Dictionary

const approvedWordList = {
  formatVersion: 1,
  source: {
    name: "synthetic test fixture",
    repository: "https://example.test/approved-words",
    commit: "fixture",
    path: "approved-words.json",
  },
  approvedWords: ["alphaword", "word-form"],
} as const satisfies ApprovedWordList

const tagger: Tagger = (text) => {
  if (text === "Attempt the repair.") {
    return [
      { text: "Attempt", pos: "VERB", lemma: "attempt", offset: 0 },
      { text: "the", pos: "DET", lemma: "the", offset: 8 },
      { text: "repair", pos: "NOUN", lemma: "repair", offset: 12 },
      { text: ".", pos: "PUNCT", lemma: ".", offset: 18 },
    ]
  }
  if (text === "The attempt failed.") {
    return [
      { text: "The", pos: "DET", lemma: "the", offset: 0 },
      { text: "attempt", pos: "NOUN", lemma: "attempt", offset: 4 },
      { text: "failed", pos: "VERB", lemma: "fail", offset: 12 },
      { text: ".", pos: "PUNCT", lemma: ".", offset: 18 },
    ]
  }
  throw new Error(`missing tagger fixture for: ${text}`)
}

describe("lint prose-file: dictionary rule", () => {
  test("allows listed words without regard to case in approved-word mode", () => {
    expect(lint("prose-file", "ALPHAWORD.", { dictionary: approvedWordList }).violations).toEqual(
      [],
    )
  })

  test("ignores Markdown container markers in approved-word mode", () => {
    expect(
      lint("prose-file", "- ALPHAWORD.\n1. Alphaword.", { dictionary: approvedWordList })
        .violations,
    ).toEqual([])
  })

  test("ignores Markdown link destinations in approved-word mode", () => {
    const text = [
      "[Alphaword](https://example.test/private-path)",
      "<https://example.test/private-path>",
      "",
      "[target]: /private/path",
      "[Alphaword][target]",
    ].join("\n")

    expect(lint("prose-file", text, { dictionary: approvedWordList }).violations).toEqual([])
  })

  test("checks prose that only resembles a Markdown link destination", () => {
    const report = lint("prose-file", "Alphaword ](betaword) word-form.", {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 13,
      },
    ])
  })

  test("checks destinations after nested links as prose", () => {
    const report = lint("prose-file", "[Alphaword [word-form](inner-target)](betaword)", {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 39,
      },
    ])
  })

  test("does not extend URI destination masks into following prose", () => {
    const report = lint("prose-file", "[Alphaword](https://example.test)Betaword", {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 34,
      },
    ])
  })

  test("ignores Markdown HTML and character reference syntax", () => {
    expect(
      lint("prose-file", '<span class="betaword">Alphaword</span> &copy; <![CDATA[betaword]]>', {
        dictionary: approvedWordList,
        rules: { semicolon: "off" },
      }).violations,
    ).toEqual([])
  })

  test("ignores HTML flow tags while retaining visible content", () => {
    const report = lint("prose-file", '<div class="attribute">\nAlphaword Betaword\n</div>', {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 2,
        column: 11,
      },
    ])
  })

  test.each(["pre", "script", "style", "textarea"])(
    "ignores raw content in %s HTML flow blocks",
    (tag) => {
      const text = `<${tag}>\nBetaword\n</${tag}>`

      expect(lint("prose-file", text, { dictionary: approvedWordList }).violations).toEqual([])
    },
  )

  test.each(["pre", "script", "style", "textarea"])(
    "retains prose after self-closing %s HTML flow tags",
    (tag) => {
      const report = lint("prose-file", `<${tag}/>\nBetaword`, {
        dictionary: approvedWordList,
      })

      expect(report.violations).toEqual([
        {
          ruleId: "dictionary-not-approved-word",
          severity: "hard",
          message: '"Betaword" is not in the approved-word list.',
          suggestions: [],
          line: 2,
          column: 1,
        },
      ])
    },
  )

  test("checks invalid tag-like text inside HTML flow blocks", () => {
    const report = lint("prose-file", "<div>\n<[Betaword]>\n</div>", {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 2,
        column: 3,
      },
    ])
  })

  test("does not pair link delimiters across Markdown inline blocks", () => {
    const report = lint("prose-file", "[Alphaword\n# word-form](Betaword)", {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 2,
        column: 14,
      },
    ])
  })

  test("keeps deep image delimiters within one Markdown inline block", () => {
    const text = `${"![".repeat(33)}Alphaword\n# ](Betaword)`
    const report = lint("prose-file", text, { dictionary: approvedWordList })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 2,
        column: 5,
      },
    ])
  })

  test("does not use deep image delimiters from code spans", () => {
    const text = `\`${"![".repeat(33)}\`](Betaword)`
    const report = lint("prose-file", text, { dictionary: approvedWordList })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 71,
      },
    ])
  })

  test("parses angle-bracket destinations in deeply nested images", () => {
    const text = `${"![x ".repeat(33)}Alphaword](<Betaword(foo>)${"](v)".repeat(32)}`
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }

    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  })

  test.each(['target "Betaword(foo"', "target 'Betaword(foo'", String.raw`target (Betaword\)foo)`])(
    "parses %s titles in deeply nested images",
    (resource) => {
      const text = `${"![x ".repeat(33)}Alphaword](${resource})${"](v)".repeat(32)}`
      const list = {
        ...approvedWordList,
        approvedWords: [...approvedWordList.approvedWords, "x"],
      }
      const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

      expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
    },
  )

  test("keeps resource brackets opaque in deeply nested images", () => {
    const text = `${"![x ".repeat(33)}[Alphaword](foo]bar)${"](v)".repeat(33)}`
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  })

  test("masks resolved full references in deeply nested images", () => {
    const text = `${"![x ".repeat(33)}Alphaword${"][r]".repeat(33)}\n\n[r]: /u`
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  })

  test("resolves deep reference suffixes before inline code spans", () => {
    const depth = 33
    const text = `${"![x ".repeat(depth)}Alphaword][r\`] Betaword \`${"](v)".repeat(depth - 1)}\n\n[r\`]: /u`
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: text.indexOf("Betaword") + 1,
      },
    ])
  })

  test("keeps unresolved deep image reference labels visible", () => {
    const text = `${"![x ".repeat(33)}Alphaword${"][r]".repeat(33)}`
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const
    const violations = lint("prose-file", text, { dictionary: list, rules }).violations

    expect(violations).toHaveLength(33)
    expect(
      violations.every(
        (violation) => violation.message === '"r" is not in the approved-word list.',
      ),
    ).toBe(true)
  })

  test("bounds valid nested full reference images", () => {
    const depth = 16_000
    const text = `${"![x ".repeat(depth)}x${"][r]".repeat(depth)}\n\n[r]: /u`
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  }, 3_000)

  test("bounds deeply nested unresolved labels", () => {
    const depth = 16_000
    const text = `${"[".repeat(depth)}Alphaword${"]".repeat(depth)}`
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(lint("prose-file", text, { dictionary: approvedWordList, rules }).violations).toEqual(
      [],
    )
  }, 3_000)

  test("masks resources on deeply nested link labels", () => {
    const text = `${"[".repeat(33)}Alphaword](Betaword)${"]".repeat(32)}`
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(
      lint("prose-file", text, { dictionary: approvedWordList, rules }).violations,
    ).toEqual([])
  })

  test.each([
    ["collapsed", "][]"],
    ["shortcut", "]"],
  ])(
    "bounds malformed nested %s reference images",
    (_kind, closing) => {
      const depth = 5_000
      const text = `${"![x ".repeat(depth)}x${closing.repeat(depth)}`
      const list = {
        ...approvedWordList,
        approvedWords: [...approvedWordList.approvedWords, "x"],
      }
      const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

      expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
    },
    3_000,
  )

  test.each([
    ["large plain prose", "Alphaword ".repeat(100_000)],
    ["many shallow images", "![Alphaword](target) ".repeat(10_000)],
  ])("does not build deep-resource indexes for %s", (_name, text) => {
    const OriginalInt32Array = globalThis.Int32Array
    let fullDocumentAllocations = 0
    const instrumentedInt32Array = new Proxy(OriginalInt32Array, {
      construct(target, argumentsList) {
        const length = argumentsList[0]
        if (typeof length === "number" && length >= text.length) fullDocumentAllocations++
        return Reflect.construct(target, argumentsList, target)
      },
    })

    globalThis.Int32Array = instrumentedInt32Array
    try {
      blankMarkdownDestinations([text])
    } finally {
      globalThis.Int32Array = OriginalInt32Array
    }

    expect(fullDocumentAllocations).toBe(1)
  })

  test("bounds deep image parsing when code spans contain brackets", () => {
    const depth = 10_000
    const text = `${"![x ".repeat(depth)}\`${"[".repeat(depth)}\`${"](v)".repeat(depth)}`
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  }, 3_000)

  test("bounds deep image parsing around opaque inline syntax", () => {
    const depth = 5_000
    const opaqueSegments = [
      `<http:${"[".repeat(depth)}>`,
      `<span data-value="${"[".repeat(depth)}">`,
    ]
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    for (const opaqueSegment of opaqueSegments) {
      const text = `${"![x ".repeat(depth)}${opaqueSegment}${"](v)".repeat(depth)}`
      expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
    }
  }, 3_000)

  test("bounds deep image parsing without creating email autolinks", () => {
    const depth = 5_000
    const text = `${"![x ".repeat(depth)}<a${"]".repeat(depth)}@x>](Betaword)`
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "a", "x"],
    }
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: text.indexOf("Betaword") + 1,
      },
    ])
  }, 3_000)

  test("bounds deep image parsing after an unmatched code span in another block", () => {
    const depth = 5_000
    const text = `\`\n# ${"![x ".repeat(depth)}x${"](v)".repeat(depth)}\``
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  }, 3_000)

  test("resolves link destinations before inline code spans", () => {
    const report = lint("prose-file", "[Alphaword](target`) Betaword `", {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 22,
      },
    ])
  })

  test("resolves deep image resources before inline code spans", () => {
    const text = `${"![x ".repeat(33)}Alphaword](target\`) Betaword \`${"](v)".repeat(32)}`
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 153,
      },
    ])
  })

  test("invalidates parent links around resolved shortcut references", () => {
    const text = "[Alphaword [word-form]](Betaword)\n\n[word-form]: /target"
    const report = lint("prose-file", text, { dictionary: approvedWordList })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 25,
      },
    ])
  })

  test("validates Markdown email autolinks", () => {
    expect(
      lint("prose-file", "<Alphaword@example.test>", { dictionary: approvedWordList }).violations,
    ).toEqual([])

    expect(
      lint("prose-file", "<Alphaword@-Betaword>", { dictionary: approvedWordList }).violations,
    ).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 13,
      },
    ])
  })

  test("checks unresolved Markdown reference labels as prose", () => {
    const report = lint("prose-file", "[Alphaword][Betaword]", {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 13,
      },
    ])
  })

  test("resolves normalized references defined in nested Markdown containers", () => {
    const text = [
      "> > > > [TaRGeT   ẞ Label]: /private/path",
      "",
      "[Alphaword][target ss label]",
    ].join("\n")

    expect(lint("prose-file", text, { dictionary: approvedWordList }).violations).toEqual([])
  })

  test("resolves references defined after source-comment prefixes", () => {
    const text = [
      "const first = 1 // [Target Label]: /private/path",
      "const second = 2 // [Alphaword][target label]",
    ].join("\n")

    expect(lint("slash-source", text, { dictionary: approvedWordList }).violations).toEqual([])
  })

  test.each([
    ["[Alphaword]: betaword extra", ["betaword", "extra"]],
    ["Alphaword\n[Alphaword]: betaword", ["betaword"]],
  ])("checks malformed or interrupting reference definitions as prose: %s", (text, unapproved) => {
    const report = lint("prose-file", text, { dictionary: approvedWordList })

    expect(report.violations.map((violation) => violation.message)).toEqual(
      unapproved.map((word) => `"${word}" is not in the approved-word list.`),
    )
  })

  test("requires horizontal separation before a next-line definition title", () => {
    expect(
      lint("prose-file", '[target]: /path\n "Betaword"', {
        dictionary: approvedWordList,
      }).violations,
    ).toEqual([])
    expect(
      lint("prose-file", ' [target]: /path\n "Betaword"', {
        dictionary: approvedWordList,
      }).violations,
    ).toEqual([])

    const report = lint("prose-file", '[target]: /path\n"Betaword"', {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 2,
        column: 2,
      },
    ])
  })

  test("measures definition title indentation from list content", () => {
    const report = lint("prose-file", '- [target]: /path\n "Betaword"', {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 2,
        column: 3,
      },
    ])
    expect(
      lint("prose-file", '- [target]: /path\n   "Betaword"', {
        dictionary: approvedWordList,
      }).violations,
    ).toEqual([])
  })

  test("keeps noninterrupting ordered list markers in the paragraph", () => {
    const report = lint("prose-file", "Alphaword\n2. [target]: Betaword", {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"2" is not in the approved-word list.',
        suggestions: [],
        line: 2,
        column: 1,
      },
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"target" is not in the approved-word list.',
        suggestions: [],
        line: 2,
        column: 5,
      },
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 2,
        column: 14,
      },
    ])
  })

  test("checks unbalanced definition destinations as prose", () => {
    const report = lint("prose-file", "[Alphaword]: Betaword(", {
      dictionary: approvedWordList,
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"Betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 14,
      },
    ])
  })

  test("bounds malformed Markdown destination parsing", () => {
    const text = "[a](".repeat(10_000)
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "a"],
    }

    expect(lint("prose-file", text, { rules }).violations).toEqual([])
    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  }, 3_000)

  test("bounds malformed CDATA probes", () => {
    const text = "<![CDATA[".repeat(10_000)
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "cdata"],
    }

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  }, 3_000)

  test("bounds unmatched resources in deeply nested images", () => {
    const depth = 10_000
    const text = `${"![x ".repeat(depth)}x${"](".repeat(depth)}`
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  }, 3_000)

  test("bounds overlapping resources in deeply nested images", () => {
    const count = 2_000
    const text = `${`${"![".repeat(33)}x](`.repeat(count)}u${")".repeat(count)}`
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "x"],
    }

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  }, 3_000)

  test("bounds nested link parsing in image descriptions", () => {
    const depth = 10_000
    const text = `${"![x [a](u) ".repeat(depth)}x${"](v)".repeat(depth)}`
    const rules = { "sentence-length": "off", "paragraph-length": "off" } as const
    const list = {
      ...approvedWordList,
      approvedWords: [...approvedWordList.approvedWords, "a", "x"],
    }

    expect(lint("prose-file", text, { dictionary: list, rules }).violations).toEqual([])
  }, 3_000)

  test("compiles a large approved-word list once across prose runs", () => {
    const approvedWords = Array.from({ length: 100_000 }, (_, index) => `synthetic-${index}`)
    approvedWords[0] = "alphaword"
    const text = Array.from(
      { length: 500 },
      (_, index) => `// ALPHAWORD.\nconst separator${index} = 0;`,
    ).join("\n")
    const list = { ...approvedWordList, approvedWords }

    expect(lint("slash-source", text, { dictionary: list }).violations).toEqual([])
  }, 3_000)

  test("flags a word that is absent from the approved-word list", () => {
    const report = lint("prose-file", "Alphaword betaword.", { dictionary: approvedWordList })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: '"betaword" is not in the approved-word list.',
        suggestions: [],
        line: 1,
        column: 11,
      },
    ])
  })

  test("treats approved word forms and hyphenated words as exact tokens", () => {
    expect(lint("prose-file", "Word-form.", { dictionary: approvedWordList }).violations).toEqual(
      [],
    )
    expect(lint("prose-file", "Alphawords.", { dictionary: approvedWordList }).violations).toEqual([
      expect.objectContaining({
        ruleId: "dictionary-not-approved-word",
        message: '"Alphawords" is not in the approved-word list.',
        line: 1,
        column: 1,
      }),
    ])
  })

  test("flags an unapproved word as hard and suggests its approved alternative", () => {
    const report = lint("prose-file", "Attempt the repair.", { dictionary, tagger })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: 'Use "try", not "Attempt".',
        suggestions: ["try"],
        line: 1,
        column: 1,
      },
    ])
  })

  test("does not flag approved alternatives", () => {
    expect(lint("prose-file", "Try the repair.", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", "It is about five millimeters.", { dictionary }).violations).toEqual(
      [],
    )
  })

  test("uses POS metadata to allow a noun and reject the same word as a verb", () => {
    expect(lint("prose-file", "The attempt failed.", { dictionary, tagger }).violations).toEqual([])
    expect(
      lint("prose-file", "Attempt the repair.", { dictionary, tagger }).violations.map(
        (violation) => violation.ruleId,
      ),
    ).toEqual(["dictionary-not-approved-word"])
  })

  test("falls back to word-level matching when POS metadata is absent", () => {
    const report = lint("prose-file", "It is approximately five millimeters.", { dictionary })

    expect(report.violations[0]).toMatchObject({
      ruleId: "dictionary-not-approved-word",
      message: 'Use "about", not "approximately".',
      suggestions: ["about"],
      column: 7,
    })
  })

  test("matches phrases across Markdown soft line breaks at the source position", () => {
    const report = lint("prose-file", "Start here.\nUse this prior\n  to assembly.", { dictionary })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: 'Use "before", not "prior to".',
        suggestions: ["before"],
        line: 2,
        column: 10,
      },
    ])
  })

  test("matches phrases across continued Markdown block quotes", () => {
    const report = lint("prose-file", "> in order\n> to continue", { dictionary })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: 'Use "to", not "in order to".',
        suggestions: ["to"],
        line: 1,
        column: 3,
      },
    ])
  })

  test("matches phrases across lazy Markdown block quote continuations", () => {
    const report = lint("prose-file", "> in order\nto continue", { dictionary })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: 'Use "to", not "in order to".',
        suggestions: ["to"],
        line: 1,
        column: 3,
      },
    ])
  })

  test("does not match phrases across Markdown block boundaries", () => {
    expect(lint("prose-file", "Do this prior\n\nto assembly.", { dictionary }).violations).toEqual(
      [],
    )
    expect(lint("prose-file", "Do this prior  \nto assembly.", { dictionary }).violations).toEqual(
      [],
    )
    expect(lint("prose-file", "# In order\nto continue", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", "- In order\n- to continue", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", "> In order\n# to continue", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", "> # In order\nto continue", { dictionary }).violations).toEqual([])
  })

  test("preserves Markdown phrase boundaries in extracted comments", () => {
    const separated = "run() // Use this prior\nnext() // > to assembly."
    const continuous = "run() // > Use this prior\nnext() // > to assembly."

    expect(lint("slash-source", separated, { dictionary }).violations).toEqual([])
    expect(lint("slash-source", continuous, { dictionary }).violations).toContainEqual(
      expect.objectContaining({ ruleId: "dictionary-not-approved-word", line: 1, column: 21 }),
    )
  })

  test("does not match phrases across Markdown indented code boundaries", () => {
    expect(lint("prose-file", "    in order\nto continue", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", "\tin order\nto continue", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", ">     in order\n> to continue", { dictionary }).violations).toEqual(
      [],
    )
  })

  test("ignores unapproved forms inside Markdown indented code", () => {
    expect(lint("prose-file", "    approximately", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", "\tin order to", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", ">     approximately", { dictionary }).violations).toEqual([])
  })

  test("ignores indented code in Markdown list containers", () => {
    expect(lint("prose-file", "-     approximately", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", "1.     in order to", { dictionary }).violations).toEqual([])
    expect(lint("prose-file", "- -     approximately", { dictionary }).violations).toEqual([])
  })

  test("checks prose in Markdown list items", () => {
    expect(lint("prose-file", "- approximately", { dictionary }).violations).toHaveLength(1)
  })

  test("keeps fenced code open until a matching delimiter closes it", () => {
    const input = "````\n~~~\n```\napproximately\n````\napproximately"
    const report = lint("prose-file", input, { dictionary })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: 'Use "about", not "approximately".',
        suggestions: ["about"],
        line: 6,
        column: 1,
      },
    ])
  })

  test("ignores fenced code in Markdown containers", () => {
    expect(lint("prose-file", "> ```\n> approximately\n> ```", { dictionary }).violations).toEqual(
      [],
    )
    expect(lint("prose-file", "- ```\n  approximately\n  ```", { dictionary }).violations).toEqual(
      [],
    )
  })

  test("checks indented CommonMark paragraph continuations", () => {
    const report = lint("prose-file", "It is\n    approximately five millimeters.", { dictionary })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: 'Use "about", not "approximately".',
        suggestions: ["about"],
        line: 2,
        column: 5,
      },
    ])
  })

  test("matches hyphenated forms as one exact token", () => {
    const report = lint("prose-file", "Use state-of-the-art parts.", {
      dictionary,
      rules: { marketing: "off" },
    })

    expect(report.violations).toEqual([
      {
        ruleId: "dictionary-not-approved-word",
        severity: "hard",
        message: 'Use "advanced", not "state-of-the-art".',
        suggestions: ["advanced"],
        line: 1,
        column: 5,
      },
    ])
    expect(lint("prose-file", "Use state of the art parts.", { dictionary }).violations).toEqual([])
  })

  test("skips POS-aware entries when no tagger is available", () => {
    expect(lint("prose-file", "Attempt the repair.", { dictionary }).violations).toEqual([])
  })
})
