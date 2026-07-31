const FENCE = /^\s{0,3}(?:```|~~~)/

export function blankCodeFences(text: string): string[] {
  let inFence = false
  return text.split("\n").map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence
      return ""
    }
    return inFence ? "" : line
  })
}
