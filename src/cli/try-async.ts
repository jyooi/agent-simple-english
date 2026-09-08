import { Effect } from "effect"

export const tryAsync = <T>(label: string, run: () => Promise<T>): Effect.Effect<T, Error> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new Error(`${label}: ${cause}`),
  })
