# TypeScript files hold no comments

No tracked TypeScript file holds a comment.
`bun run lint` runs `scripts/check-no-comments.ts`, which fails when a comment appears and names the file and the line.
Biome 2.5.12 supplies no rule for this, and a Biome plugin cannot match a comment.
The shebang line is the only permitted comment, and `test/fixtures` is the only excluded path.
A name tells the reader what the code does.
A test name holds a reason that the test guards.
This record holds the one reason that a name or a test cannot hold.

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
