import { describe, expect, test } from "vitest"
import { lint } from "../../src/engine/lint.ts"

const idsFor = (text: string) => lint("html", text).violations.map((violation) => violation.ruleId)

const words = (count: number, start = 1): string =>
  Array.from({ length: count }, (_, index) => `word${index + start}`).join(" ")

describe("lint html: prose blocks", () => {
  test("flags an overlong sentence in a paragraph at its original position", () => {
    const page = ["<html>", "<body>", `  <p>${words(30)}.</p>`, "</body>", "</html>"].join("\n")

    const violation = lint("html", page).violations.find(
      (candidate) => candidate.ruleId === "sentence-length",
    )

    expect(violation).toMatchObject({
      ruleId: "sentence-length",
      severity: "hard",
      line: 3,
      column: 6,
    })
  })

  test("flags a semicolon in a paragraph at its original column", () => {
    const violation = lint("html", "<p>Start the job; then stop it.</p>").violations.find(
      (candidate) => candidate.ruleId === "semicolon",
    )

    expect(violation).toMatchObject({ ruleId: "semicolon", severity: "hard", line: 1, column: 17 })
  })

  test("flags bare text placed directly inside a div", () => {
    const page = ["<div>", "  Do not use a contraction that isn't approved.", "</div>"].join("\n")

    const violation = lint("html", page).violations.find(
      (candidate) => candidate.ruleId === "contraction",
    )

    expect(violation).toMatchObject({ ruleId: "contraction", line: 2, column: 33 })
  })

  test("flags an overlong title element", () => {
    const page = `<head><title>${words(30)}.</title></head>`

    expect(idsFor(page)).toContain("sentence-length")
  })

  test("reports no violation for clean prose", () => {
    const page = [
      "<html>",
      "<body>",
      "  <h1>Clean heading</h1>",
      "  <p>This page uses short sentences. Each sentence stays inside the limit.</p>",
      "</body>",
      "</html>",
    ].join("\n")

    expect(lint("html", page).violations).toEqual([])
  })
})

describe("lint html: ignored regions", () => {
  test("does not flag a semicolon inside a style block", () => {
    const page = "<style>a { color: red; background: blue; }</style>"

    expect(idsFor(page)).not.toContain("semicolon")
  })

  test("does not flag a semicolon inside an inline script", () => {
    const page = "<script>const first = 1; const second = 2;</script>"

    expect(idsFor(page)).not.toContain("semicolon")
  })

  test("does not flag content inside pre, code, and textarea", () => {
    const page = [
      "<pre>alpha; beta</pre>",
      "<p><code>gamma; delta</code></p>",
      "<textarea>epsilon; zeta</textarea>",
    ].join("\n")

    expect(idsFor(page)).not.toContain("semicolon")
  })

  test("does not flag an attribute value", () => {
    const page = `<div title="Alpha; beta" data-note="${words(30)}."></div>`

    expect(lint("html", page).violations).toEqual([])
  })

  test("does not flag an HTML comment", () => {
    const page = `<!-- ${words(30)}; done. -->\n<p>Short prose.</p>`

    expect(lint("html", page).violations).toEqual([])
  })

  test("does not read an entity reference as a semicolon", () => {
    const page = "<p>Alpha&nbsp;beta gamma.</p>"

    expect(idsFor(page)).not.toContain("semicolon")
  })

  test("keeps a paragraph semicolon beside a style block", () => {
    const page = ["<style>a { color: red; }</style>", "<p>Start the job; then stop.</p>"].join("\n")

    const semicolons = lint("html", page).violations.filter(
      (candidate) => candidate.ruleId === "semicolon",
    )

    expect(semicolons).toHaveLength(1)
    expect(semicolons[0]).toMatchObject({ line: 2, column: 17 })
  })
})

describe("lint html: block boundaries", () => {
  test("counts a sentence split across inline elements as one sentence", () => {
    const page = `<p>${words(2)} <em>word3</em> <a href="x.html">word4</a> ${words(26, 5)}.</p>`

    const violations = lint("html", page).violations.filter(
      (candidate) => candidate.ruleId === "sentence-length",
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 1, column: 4 })
  })

  test("does not join a heading with the paragraph that follows it", () => {
    const page = [`<h1>${words(15)}</h1>`, `<p>${words(15, 16)}</p>`].join("\n")

    expect(idsFor(page)).not.toContain("sentence-length")
  })

  test("does not join sibling list items", () => {
    const page = `<ul><li>${words(15)}</li><li>${words(15, 16)}</li></ul>`

    expect(idsFor(page)).not.toContain("sentence-length")
  })

  test("does not join sibling table cells on one line", () => {
    const page = `<table><tr><td>${words(15)}</td><td>${words(15, 16)}</td></tr></table>`

    expect(idsFor(page)).not.toContain("sentence-length")
  })

  test("does not join text across a line break element", () => {
    const page = `<p>${words(15)}<br>${words(15, 16)}</p>`

    expect(idsFor(page)).not.toContain("sentence-length")
  })

  test("joins a sentence that spans source lines inside one paragraph", () => {
    const page = ["<p>", `  ${words(15)}`, `  ${words(15, 16)}.`, "</p>"].join("\n")

    const violations = lint("html", page).violations.filter(
      (candidate) => candidate.ruleId === "sentence-length",
    )

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 2, column: 3 })
  })

  test("counts paragraph length inside one prose block", () => {
    const sentences = Array.from({ length: 7 }, (_, index) => `Sentence ${index + 1} is short.`)

    expect(idsFor(`<p>${sentences.join(" ")}</p>`)).toContain("paragraph-length")
  })

  test("does not count paragraph length across sibling paragraphs", () => {
    const page = Array.from(
      { length: 7 },
      (_, index) => `<p>Sentence ${index + 1} is short.</p>`,
    ).join("\n")

    expect(idsFor(page)).not.toContain("paragraph-length")
  })

  test("keeps positions in a page that mixes style, script, and prose", () => {
    const page = [
      "<!doctype html>",
      "<html>",
      "  <head>",
      "    <style>",
      "      .card { margin: 0; padding: 0; }",
      "    </style>",
      "    <script>const total = 1; const count = 2;</script>",
      "  </head>",
      "  <body>",
      `    <p>${words(30)}.</p>`,
      "  </body>",
      "</html>",
    ].join("\n")

    expect(lint("html", page).violations).toEqual([
      expect.objectContaining({ ruleId: "sentence-length", line: 10, column: 8 }),
    ])
  })
})

describe("lint html: suppression", () => {
  test("an HTML comment directive suppresses the next line", () => {
    const page = [
      "<div>",
      "  <!-- ste-disable-next-line semicolon -->",
      "  <p>Start the job; then stop.</p>",
      "</div>",
    ].join("\n")

    expect(idsFor(page)).not.toContain("semicolon")
  })
})
