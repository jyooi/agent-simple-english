import { mock } from "bun:test"
import * as fs from "node:fs/promises"

const originalReadFile = fs.readFile

mock.module("node:fs/promises", () => ({
  ...fs,
  readFile: async (...args) => {
    const path = args[0]
    if (
      typeof path === "string" &&
      path.endsWith(".jsonl") &&
      (await fs.stat(path)).size > 1024 * 1024
    ) {
      throw new Error("forced complete transcript read failure")
    }
    return originalReadFile(...args)
  },
}))
