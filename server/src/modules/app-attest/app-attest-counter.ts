export const COUNTER_WINDOW = 64;

export interface CounterState {
  counter: number;
  recentCounters: Set<number>;
}

/**
 * Requests signed back to back reach the server in any order, so a counter below the highest seen is
 * still fresh when it is inside the window and has not been used. Anything older, or used before,
 * is a replay. Counter 0 belongs to the attestation and never signs a request.
 */
export function isFreshCounter(state: CounterState, counter: number): boolean {
  if (!Number.isSafeInteger(counter) || counter < 1) return false;
  if (counter > state.counter) return true;
  return counter > state.counter - COUNTER_WINDOW && !state.recentCounters.has(counter);
}

export function acceptCounter(state: CounterState, counter: number): void {
  state.recentCounters.add(counter);
  state.counter = Math.max(state.counter, counter);
  for (const seen of state.recentCounters) {
    if (seen <= state.counter - COUNTER_WINDOW) state.recentCounters.delete(seen);
  }
}
