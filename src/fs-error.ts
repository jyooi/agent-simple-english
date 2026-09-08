export function isFileError(cause: unknown, code: string): boolean {
  return (
    typeof cause === "object" && cause !== null && (cause as NodeJS.ErrnoException).code === code
  )
}
