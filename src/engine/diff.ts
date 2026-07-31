export interface ChangedRange {
  readonly start: number
  readonly end: number
}

export interface Deletion {
  readonly previousStart: number
  readonly previousEnd: number
  readonly currentOffset: number
}

export interface RetainedRange {
  readonly previousStart: number
  readonly currentStart: number
  readonly length: number
}

export interface TextChanges {
  readonly ranges: readonly ChangedRange[]
  readonly deletions: readonly Deletion[]
  readonly retained: readonly RetainedRange[]
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

function addRange(ranges: ChangedRange[], start: number, end: number): void {
  if (start === end) return
  const last = ranges.at(-1)
  if (last && start <= last.end) {
    ranges[ranges.length - 1] = { start: last.start, end: Math.max(last.end, end) }
    return
  }
  ranges.push({ start, end })
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

function diffCharacters(
  previous: string,
  current: string,
  previousOffset: number,
  currentOffset: number,
  ranges: ChangedRange[],
  deletions: Deletion[],
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
  const suffixLength = previous.length - previousEnd
  const retainEdges = () => {
    addRetained(retained, previousOffset, currentOffset, prefix)
    addRetained(
      retained,
      previousOffset + previousEnd,
      currentOffset + currentEnd,
      suffixLength,
    )
  }

  if (oldText.length === 0) {
    addRetained(retained, previousOffset, currentOffset, prefix)
    addRange(ranges, newBase, newBase + newText.length)
    addRetained(
      retained,
      previousOffset + previousEnd,
      currentOffset + currentEnd,
      suffixLength,
    )
    return
  }
  if (newText.length === 0) {
    addRetained(retained, previousOffset, currentOffset, prefix)
    deletions.push({
      previousStart: oldBase,
      previousEnd: oldBase + oldText.length,
      currentOffset: newBase,
    })
    addRetained(
      retained,
      previousOffset + previousEnd,
      currentOffset + currentEnd,
      suffixLength,
    )
    return
  }
  if (!reserveCells(budget, oldText.length, newText.length)) {
    retainEdges()
    addRange(ranges, newBase, newBase + newText.length)
    deletions.push({
      previousStart: oldBase,
      previousEnd: oldBase + oldText.length,
      currentOffset: newBase,
    })
    return
  }

  addRetained(retained, previousOffset, currentOffset, prefix)

  const width = newText.length + 1
  const table = new Int32Array((oldText.length + 1) * width)
  const lcs = (oldIndex: number, newIndex: number) => table[oldIndex * width + newIndex] ?? 0
  for (let oldIndex = oldText.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newText.length - 1; newIndex >= 0; newIndex--) {
      table[oldIndex * width + newIndex] =
        oldText[oldIndex] === newText[newIndex]
          ? lcs(oldIndex + 1, newIndex + 1) + 1
          : Math.max(lcs(oldIndex + 1, newIndex), lcs(oldIndex, newIndex + 1))
    }
  }

  let oldIndex = 0
  let newIndex = 0
  let deletionStart: number | undefined
  let deletionPoint = 0
  const flushDeletion = () => {
    if (deletionStart === undefined) return
    deletions.push({
      previousStart: oldBase + deletionStart,
      previousEnd: oldBase + oldIndex,
      currentOffset: newBase + deletionPoint,
    })
    deletionStart = undefined
  }

  while (oldIndex < oldText.length && newIndex < newText.length) {
    if (oldText[oldIndex] === newText[newIndex]) {
      flushDeletion()
      addRetained(retained, oldBase + oldIndex, newBase + newIndex, 1)
      oldIndex++
      newIndex++
    } else if (lcs(oldIndex + 1, newIndex) >= lcs(oldIndex, newIndex + 1)) {
      if (deletionStart === undefined) {
        deletionStart = oldIndex
        deletionPoint = newIndex
      }
      oldIndex++
    } else {
      flushDeletion()
      addRange(ranges, newBase + newIndex, newBase + newIndex + 1)
      newIndex++
    }
  }
  while (oldIndex < oldText.length) {
    if (deletionStart === undefined) {
      deletionStart = oldIndex
      deletionPoint = newIndex
    }
    oldIndex++
  }
  flushDeletion()
  addRange(ranges, newBase + newIndex, newBase + newText.length)
  addRetained(
    retained,
    previousOffset + previousEnd,
    currentOffset + currentEnd,
    suffixLength,
  )
}

export function changedText(previousText: string, currentText: string): TextChanges {
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
  const ranges: ChangedRange[] = []
  const deletions: Deletion[] = []
  const retained: RetainedRange[] = []
  const budget: DiffBudget = { remaining: DIFF_CELL_LIMIT }
  addRetained(retained, 0, 0, currentOffset)

  if (!reserveCells(budget, oldLines.length, newLines.length)) {
    const oldText = oldLines.join("")
    const newText = newLines.join("")
    if (newText.length > 0) {
      addRange(ranges, currentOffset, currentOffset + newText.length)
    } else if (oldText.length > 0) {
      deletions.push({
        previousStart: previousOffset,
        previousEnd: previousOffset + oldText.length,
        currentOffset,
      })
    }
    addRetained(
      retained,
      previousOffset + oldText.length,
      currentOffset + newText.length,
      previousText.length - previousOffset - oldText.length,
    )
    return { ranges, deletions, retained }
  }

  const width = newLines.length + 1
  const table = new Int32Array((oldLines.length + 1) * width)
  const lcs = (oldIndex: number, newIndex: number) => table[oldIndex * width + newIndex] ?? 0
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      table[oldIndex * width + newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? lcs(oldIndex + 1, newIndex + 1) + 1
          : Math.max(lcs(oldIndex + 1, newIndex), lcs(oldIndex, newIndex + 1))
    }
  }

  let oldIndex = 0
  let newIndex = 0
  let oldChunk = ""
  let newChunk = ""
  let oldChunkOffset = previousOffset
  let newChunkOffset = currentOffset
  const flushChunk = () => {
    if (oldChunk === "" && newChunk === "") return
    diffCharacters(
      oldChunk,
      newChunk,
      oldChunkOffset,
      newChunkOffset,
      ranges,
      deletions,
      retained,
      budget,
    )
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

  return { ranges, deletions, retained }
}
