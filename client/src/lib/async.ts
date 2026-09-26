/**
 * A monotonic token for "is the answer I am holding still the one that was asked for". Every
 * param-driven read in the app needs this, and hand-rolling it per module is how the semantics
 * drift: capture the token before the request, check it before writing state.
 */
export function createRequestGeneration() {
  let generation = 0

  return {
    /** Starts a request and invalidates every older one. */
    begin(): number {
      return ++generation
    },
    /** Reads the current token without starting a request, for a read that may become stale. */
    current(): number {
      return generation
    },
    isCurrent(token: number): boolean {
      return token === generation
    },
    /** Invalidates everything in flight, for a reset or a user change. */
    invalidate(): void {
      generation++
    },
  }
}

/**
 * Shares one in-flight request between concurrent callers instead of issuing several. `keyOf`
 * separates independent requests; omit it when the call takes no arguments.
 */
export function createCoalescedFetch<TArgs extends unknown[], TResult>(
  fetcher: (...args: TArgs) => Promise<TResult>,
  keyOf: (...args: TArgs) => string = () => '',
) {
  const pending = new Map<string, Promise<TResult>>()

  function run(...args: TArgs): Promise<TResult> {
    const key = keyOf(...args)
    const existing = pending.get(key)
    if (existing) return existing
    const request = fetcher(...args).finally(() => {
      if (pending.get(key) === request) pending.delete(key)
    })
    pending.set(key, request)
    return request
  }

  /** Drops the shared promises so the next call starts a fresh request. */
  run.clear = (): void => pending.clear()
  run.inFlight = (...args: TArgs): boolean => pending.has(keyOf(...args))

  return run
}
