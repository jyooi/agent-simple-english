// Longest-common-subsequence line diff. Returns the 1-based line numbers of
// the current text that are new or changed relative to the previous text.
// Deleted lines have no counterpart in the current text, so they never appear.
export function changedLineNumbers(previousText: string, currentText: string): Set<number> {
  const previous = previousText.split("\n")
  const current = currentText.split("\n")

  let start = 0
  while (start < previous.length && start < current.length && previous[start] === current[start]) {
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

  const a = previous.slice(start, previousEnd)
  const b = current.slice(start, currentEnd)

  const changed = new Set<number>()
  const markAll = () => {
    for (let i = 0; i < b.length; i++) {
      changed.add(start + i + 1)
    }
  }

  // The DP table is quadratic; past this bound, conservatively treat the whole
  // middle as changed rather than risk pathological memory use on huge edits.
  if (a.length * b.length > 1_000_000) {
    markAll()
    return changed
  }

  const width = b.length + 1
  const table = new Int32Array((a.length + 1) * width)
  const lcs = (i: number, j: number) => table[i * width + j] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1))
    }
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if (lcs(i + 1, j) >= lcs(i, j + 1)) {
      i++
    } else {
      changed.add(start + j + 1)
      j++
    }
  }
  for (; j < b.length; j++) {
    changed.add(start + j + 1)
  }

  return changed
}
