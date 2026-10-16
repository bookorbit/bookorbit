import { onMounted, shallowRef } from 'vue'
import type { AchievementHint } from '@bookorbit/types'
import { fetchAchievementHints } from '../api/achievementsApi'

/**
 * "How to get it" hints by achievement key, fetched apart from the catalogue so the page never waits on
 * them. There is no loading state: hints are extra, so the page shows none until they land, and a
 * refetch or a failure leaves the last ones in place.
 */
export function useAchievementHints() {
  const hints = shallowRef<ReadonlyMap<string, AchievementHint>>(new Map())

  async function load(): Promise<void> {
    try {
      const data = await fetchAchievementHints()
      hints.value = new Map((Array.isArray(data?.hints) ? data.hints : []).map((hint) => [hint.key, hint]))
    } catch {
      // Keep whatever was shown; the page reads fine without hints.
    }
  }

  onMounted(load)

  return { hints, reload: load }
}
