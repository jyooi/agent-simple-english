import { mock } from "bun:test"
import * as fs from "node:fs/promises"

const originalReadFile = fs.readFile
const originalBufferConcat = Buffer.concat

Buffer.concat = (list, totalLength) => {
  const length = totalLength ?? list.reduce((total, buffer) => total + buffer.length, 0)
  if (length > 1024 * 1024) throw new Error("forced large buffer concatenation failure")
  return originalBufferConcat(list, totalLength)
}

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
