import { computed, ref, watch, type Ref } from 'vue'
import type { PodcastLibraryActivity } from '@bookorbit/types'
import { apiJson } from '@/lib/api-json'
import { usePodcastEvents } from './usePodcastEvents'

/** A bulk retry completes many feeds at once; one recount for the burst is enough. */
const RECOUNT_DEBOUNCE_MS = 500

/**
 * How many feeds in a library are currently failing, counted by the server across the whole library.
 *
 * The health warning is a library-wide fact, so it cannot be read off a loaded page of shows: that
 * page is narrowed by search, paged at 50, and empty entirely on any tab the shows lane never
 * backed. `/activity` answers with counters only, and the refresh events already flowing keep the
 * number current without polling.
 */
export function usePodcastFailingFeedCount(libraryId: Ref<number>, enabled: Ref<boolean>) {
  const events = usePodcastEvents()
  const count = ref(0)
  let recountTimer: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<void> {
    if (!enabled.value || !Number.isInteger(libraryId.value) || libraryId.value <= 0) return
    try {
      const activity = await apiJson<PodcastLibraryActivity>(
        `/api/v1/podcast-libraries/${libraryId.value}/activity`,
        undefined,
        'podcast.errors.loadHealth',
      )
      count.value = activity.failingFeeds
    } catch {
      // A badge that cannot be counted stays silent rather than claiming either state; the health
      // lane itself still reports the truth when opened.
      count.value = 0
    }
  }

  events.onRefreshComplete((event) => {
    if (event.libraryId !== libraryId.value) return
    if (recountTimer) clearTimeout(recountTimer)
    recountTimer = setTimeout(() => {
      recountTimer = null
      void load()
    }, RECOUNT_DEBOUNCE_MS)
  })

  watch([libraryId, enabled], () => void load(), { immediate: true })

  return { hasFailingFeeds: computed(() => count.value > 0) }
}
