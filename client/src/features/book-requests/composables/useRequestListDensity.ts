import { ref } from 'vue'

/**
 * There is one list. The choice is how tall its rows are, not which component draws them: cards
 * and the table carried the same fields, so keeping both meant two places for every new action.
 */
export type RequestListDensity = 'comfortable' | 'compact'

const STORAGE_KEY = 'bookorbit.requests.density'

function readStored(): RequestListDensity {
  try {
    // Anything else, including the `cards` and `table` this key used to hold, lands on the default.
    return localStorage.getItem(STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    // Private browsing and blocked storage both throw here; the default is still usable.
    return 'comfortable'
  }
}

/**
 * Module-level so the choice holds while moving between the two list tabs, rather than resetting
 * every time the panel remounts.
 */
const density = ref<RequestListDensity>(readStored())

export function useRequestListDensity() {
  function setDensity(next: RequestListDensity): void {
    density.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // A preference that cannot be persisted still applies for this session.
    }
  }

  return { density, setDensity }
}
