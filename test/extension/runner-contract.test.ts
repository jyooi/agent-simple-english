import { ExtensionRunner } from "@earendil-works/pi-coding-agent"
import { expect, test } from "vitest"

// This file must never import the extension, directly or through a helper. The strict output
// boundary in src/extension/index.ts defines these three methods on ExtensionRunner.prototype at
// import time. A patched prototype would satisfy the assertions below even after pi removed the
// method, so the guard would pass with nothing behind it. Vitest isolates each test file, which
// keeps this module graph free of the patch, and the registry assertion pins that precondition.
test("pi defines the runner methods that the strict output boundary patches", () => {
  const boundary = globalThis as { __simpleEnglishStrictBoundaryV1?: unknown }

  expect(boundary.__simpleEnglishStrictBoundaryV1).toBeUndefined()
  expect(typeof ExtensionRunner.prototype.emit).toBe("function")
  expect(typeof ExtensionRunner.prototype.emitMessageEnd).toBe("function")
  expect(typeof ExtensionRunner.prototype.emitToolResult).toBe("function")
})
