export interface RetainedRange {
  readonly previousStart: number
  readonly currentStart: number
  readonly length: number
}

const DIFF_CELL_LIMIT = 1_000_000

interface DiffBudget {
  remaining: number
}

function reserveCells(budget: DiffBudget, previousLength: number, currentLength: number): boolean {
  const cells = previousLength * currentLength
  if (cells > budget.remaining) return false
  budget.remaining -= cells
  return true
}

function lineTokens(text: string): string[] {
  const tokens: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
      tokens.push(text.slice(start, index + 1))
      start = index + 1
    }
  }
  if (start < text.length) {
    tokens.push(text.slice(start))
  }
  return tokens
}

function addRetained(
  retained: RetainedRange[],
  previousStart: number,
  currentStart: number,
  length: number,
): void {
  if (length === 0) return
  const last = retained.at(-1)
  if (
    last &&
    last.previousStart + last.length === previousStart &&
    last.currentStart + last.length === currentStart
  ) {
    retained[retained.length - 1] = { ...last, length: last.length + length }
    return
  }
  retained.push({ previousStart, currentStart, length })
}

function lcsTable(previous: ArrayLike<string>, current: ArrayLike<string>) {
  const width = current.length + 1
  const table = new Int32Array((previous.length + 1) * width)
  const lcs = (oldIndex: number, newIndex: number) => table[oldIndex * width + newIndex] ?? 0
  for (let oldIndex = previous.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = current.length - 1; newIndex >= 0; newIndex--) {
      table[oldIndex * width + newIndex] =
        previous[oldIndex] === current[newIndex]
          ? lcs(oldIndex + 1, newIndex + 1) + 1
          : Math.max(lcs(oldIndex + 1, newIndex), lcs(oldIndex, newIndex + 1))
    }
  }
  return lcs
}

function retainCharacters(
  previous: string,
  current: string,
  previousOffset: number,
  currentOffset: number,
  retained: RetainedRange[],
  budget: DiffBudget,
): void {
  let prefix = 0
  while (
    prefix < previous.length &&
    prefix < current.length &&
    previous[prefix] === current[prefix]
  ) {
    prefix++
  }

  let previousEnd = previous.length
  let currentEnd = current.length
  while (
    previousEnd > prefix &&
    currentEnd > prefix &&
    previous[previousEnd - 1] === current[currentEnd - 1]
  ) {
    previousEnd--
    currentEnd--
  }

  const oldText = previous.slice(prefix, previousEnd)
  const newText = current.slice(prefix, currentEnd)
  const oldBase = previousOffset + prefix
  const newBase = currentOffset + prefix

  addRetained(retained, previousOffset, currentOffset, prefix)
  if (
    oldText.length > 0 &&
    newText.length > 0 &&
    reserveCells(budget, oldText.length, newText.length)
  ) {
    const lcs = lcsTable(oldText, newText)
    let oldIndex = 0
    let newIndex = 0
    while (oldIndex < oldText.length && newIndex < newText.length) {
      if (oldText[oldIndex] === newText[newIndex]) {
        addRetained(retained, oldBase + oldIndex, newBase + newIndex, 1)
        oldIndex++
        newIndex++
      } else if (lcs(oldIndex + 1, newIndex) >= lcs(oldIndex, newIndex + 1)) {
        oldIndex++
      } else {
        newIndex++
      }
    }
  }
  addRetained(
    retained,
    previousOffset + previousEnd,
    currentOffset + currentEnd,
    previous.length - previousEnd,
  )
}

/**
 * Character ranges that survive unchanged between two texts, in document order.
 * Line-level LCS first, then character-level LCS inside changed line chunks,
 * with a cell budget that falls back to prefix and suffix matching on huge edits.
 */
export function retainedRanges(previousText: string, currentText: string): RetainedRange[] {
  const previous = lineTokens(previousText)
  const current = lineTokens(currentText)

  let start = 0
  let previousOffset = 0
  let currentOffset = 0
  while (start < previous.length && start < current.length && previous[start] === current[start]) {
    previousOffset += previous[start]?.length ?? 0
    currentOffset += current[start]?.length ?? 0
    start++
  }

  let previousEnd = previous.length
  let currentEnd = current.length
  while (
    previousEnd > start &&
    currentEnd > start &&
    previous[previousEnd - 1] === current[currentEnd - 1]
  ) {
    previousEnd--
    currentEnd--
  }

  const oldLines = previous.slice(start, previousEnd)
  const newLines = current.slice(start, currentEnd)
  const retained: RetainedRange[] = []
  const budget: DiffBudget = { remaining: DIFF_CELL_LIMIT }
  addRetained(retained, 0, 0, currentOffset)

  if (!reserveCells(budget, oldLines.length, newLines.length)) {
    const oldLength = oldLines.join("").length
    const newLength = newLines.join("").length
    addRetained(
      retained,
      previousOffset + oldLength,
      currentOffset + newLength,
      previousText.length - previousOffset - oldLength,
    )
    return retained
  }

  const lcs = lcsTable(oldLines, newLines)
  let oldIndex = 0
  let newIndex = 0
  let oldChunk = ""
  let newChunk = ""
  let oldChunkOffset = previousOffset
  let newChunkOffset = currentOffset
  const flushChunk = () => {
    if (oldChunk === "" && newChunk === "") return
    retainCharacters(oldChunk, newChunk, oldChunkOffset, newChunkOffset, retained, budget)
    oldChunk = ""
    newChunk = ""
  }

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      flushChunk()
      const lineLength = oldLines[oldIndex]?.length ?? 0
      addRetained(retained, previousOffset, currentOffset, lineLength)
      previousOffset += lineLength
      currentOffset += lineLength
      oldIndex++
      newIndex++
      oldChunkOffset = previousOffset
      newChunkOffset = currentOffset
    } else if (lcs(oldIndex + 1, newIndex) >= lcs(oldIndex, newIndex + 1)) {
      oldChunk += oldLines[oldIndex] ?? ""
      previousOffset += oldLines[oldIndex]?.length ?? 0
      oldIndex++
    } else {
      newChunk += newLines[newIndex] ?? ""
      currentOffset += newLines[newIndex]?.length ?? 0
      newIndex++
    }
  }
  while (oldIndex < oldLines.length) {
    oldChunk += oldLines[oldIndex] ?? ""
    previousOffset += oldLines[oldIndex]?.length ?? 0
    oldIndex++
  }
  while (newIndex < newLines.length) {
    newChunk += newLines[newIndex] ?? ""
    currentOffset += newLines[newIndex]?.length ?? 0
    newIndex++
  }
  flushChunk()
  addRetained(retained, previousOffset, currentOffset, previousText.length - previousOffset)

  return retained
}
