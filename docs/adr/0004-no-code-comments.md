# TypeScript files hold no comments

The TypeScript files under `src` and `test` hold no comments.
`test/no-comments.test.ts` fails when a comment appears, and it names the file and the line.
The shebang line of `src/cli/main.ts` and the test data under `test/fixtures` are the only exceptions.
A name tells the reader what the code does.
A test name holds a reason that the test guards.
This record holds each reason that a name or a test cannot hold.

## The strict output boundary of the pi Adapter

`installStrictOutputBoundary` in `src/extension/index.ts` replaces three methods on `ExtensionRunner.prototype`.
The methods are `emit`, `emitMessageEnd`, and `emitToolResult`.
Strict mode must make the last decision on the text that the user reads, and the public hooks of pi cannot give that.
The `emit` method of pi drops the handler results for each event except the `session_before_*` events.
The `message_end` and `tool_result` events chain their handlers in extension load order, and the last writer wins.
No `pi.on` overload takes a priority, so a later extension can restore prose that this extension removed.

The three replacement methods run after the full handler loop, and no other seam does.
Four assumptions hold this design together, and each one fails without an error.

1. pi calls `emit`, `emitMessageEnd`, and `emitToolResult`.
   After a rename in pi, the replacement stays on the prototype, pi does not call it, and redaction stops.
2. The extension and the host share one `ExtensionRunner` class object.
   The pi loader aliases the package specifier to the module that the host runs, so this prototype is the live one.
3. `createContext().sessionManager` keeps one identity, because it is the key of the WeakMap in `boundaryRegistry.states`.
   A new wrapper for each call makes each lookup fail.
4. The `pi.on("tool_result")` handler stays registered.
   `AgentSession` in pi calls `emitToolResult` only when `hasHandlers("tool_result")` is true, so the replacement is dead without that handler.

`test/extension/runner-contract.test.ts` guards the first assumption.
That file must not import the extension, directly or through a helper.
The import replaces the methods, and a replaced prototype satisfies the assertions after pi removes a method.
Vitest isolates each test file, which keeps the replacement out of that module graph.
The strict mode tests in `test/extension/extension.test.ts` guard the behavior of the boundary.

## Other reasons

- `MaxSentenceWordsSchema` in `src/config/schema.ts` is one refinement over `Schema.Unknown`.
  Thus a wrong type and a wrong number give the same text and the rejected value.
- `DECODE_OPTIONS_THAT_REPORT_REJECTED_VALUE` in `src/schema/parse-error.ts` sets `reportInput`.
  Effect v4 omits the rejected value from an issue without that option.
- `pathSegments` in `src/schema/parse-error.ts` changes each key to text.
  Symbol keys do not occur in the schemas of this package.
- `NonEmptyTrimmedString` in `src/schema/primitives.ts` exists because Effect v4 supplies no such schema.
- `withoutJitiDefaultProperty` in `src/dictionary/bundled-rule-data.ts` copies the enumerable properties only.
  Jiti adds a non-enumerable `default` property, and strict schema validation rejects it.
- `LEAF_BLOCK_TOKENS` in `src/engine/markdown.ts` gives one leaf block to each line group.
  Each rule reads `BlockStructure`, so no rule needs its own Markdown classifier.
- `singleLineHtmlComments` in `src/engine/html.ts` uses the lezer parser.
  The Markdown finder cannot see a comment that Markdown reads as indented code.
- `code` is in `NON_PROSE_CONTENT_TAGS` and in `PHRASING_TAGS_INSIDE_ONE_SENTENCE`.
  Thus a semicolon in inline code gives no finding, and the sentence around it stays one sentence.
- `hasSignalThatProseWordsLack` in `src/engine/identifiers.ts` also exempts a prose word with mixed case, such as a brand name.
  The project accepts this loss.
- `DATA_OR_STYLE_NOT_PROSE` in `src/engine/kinds.ts` skips data files and style files.
  The prose rules read their rules and structured data as sentences, which is incorrect (HUF-308).
- `isNonProgressiveVerbAfterAuxiliary` in `src/engine/rules/verb-form.ts` accepts each verb that does not end in "ing".
  This covers irregular past participles such as "broken" and "sent" without a list.
- `makeWinkTagger` in `src/tagger/wink.ts` casts `its.lemma`.
  The type declaration of wink-nlp gives it a signature that `token.out` rejects, but it is a valid helper at run time.
- `makeWinkTagger` finds each token offset by a scan of the input text.
  wink-nlp supplies no character offsets, and each token value is an exact slice of the input.
- `makeLazyWinkTagger` loads the model at the first tag call, so a hook event that lints no prose stays fast.
- `caseFoldKey` in `src/engine/case-fold.ts` uses `toLowerCase`.
  It does not fold sharp s to "ss", and it does not merge the sigma forms.
  A test in `test/engine/marketing.test.ts` pins this known limit.
  Use full Unicode case folding again if a dictionary needs it.
- `LintOptions.previousText` in `src/engine/types.ts` is the previous document text.
  With it, the engine reports only new violations, and it compares sentence and paragraph violations by structure.
  The positions refer to the current text.
- `retainedRanges` in `src/engine/diff.ts` applies a line-level LCS first.
  Then it applies a character-level LCS in each changed chunk, within the budget of `DIFF_CELL_LIMIT`.
  Above that budget, it matches only the prefix and the suffix.
