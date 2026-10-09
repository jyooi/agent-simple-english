import { ExtensionRunner } from "@earendil-works/pi-coding-agent"
import { expect, test } from "vitest"

test("pi defines the runner methods that the strict output boundary patches, in a module graph that never imports the extension", () => {
  const boundary = globalThis as { __simpleEnglishStrictBoundaryV1?: unknown }

  expect(boundary.__simpleEnglishStrictBoundaryV1).toBeUndefined()
  expect(typeof ExtensionRunner.prototype.emit).toBe("function")
  expect(typeof ExtensionRunner.prototype.emitMessageEnd).toBe("function")
  expect(typeof ExtensionRunner.prototype.emitToolResult).toBe("function")
})
