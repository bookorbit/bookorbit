import { computed, ref, type Ref } from 'vue'
import { i18n } from '@/i18n'
import { ApiError } from '@/lib/api-json'
import { createRequestGeneration } from '@/lib/async'

export interface PodcastListLaneOptions<TItem> {
  /** Reads one page. `page` is 0-based, as everywhere else in the app. */
  fetchPage: (page: number, size: number) => Promise<{ items: TItem[]; total: number }>
  /** Localized copy for a failure the server did not name with an error code. */
  fallbackKey: string
}

/**
 * One paged list with its own loading, error and request token. The library page shows four of
 * these, and they used to share a single set: loading the queue tab silently cancelled an episodes
 * request that was still open, and a failure on one lane painted an error over another.
 */
export function createPodcastListLane<TItem>(options: PodcastListLaneOptions<TItem>) {
  const items = ref([]) as Ref<TItem[]>
  const total = ref(0)
  const page = ref(0)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  /** Whether this lane has ever answered, which is what tells an empty list from an unloaded one. */
  const initialized = ref(false)
  const generation = createRequestGeneration()

  const hasMore = computed(() => initialized.value && items.value.length < total.value)
  const busy = computed(() => loading.value || loadingMore.value)

  async function load(append = false, size = 50): Promise<void> {
    const requestedPage = append ? page.value + 1 : 0
    const activeGeneration = generation.begin()
    if (append) loadingMore.value = true
    else loading.value = true
    error.value = null
    try {
      const result = await options.fetchPage(requestedPage, size)
      if (!generation.isCurrent(activeGeneration)) return
      items.value = append ? [...items.value, ...result.items] : result.items
      page.value = requestedPage
      total.value = result.total
      initialized.value = true
    } catch (reason) {
      if (!generation.isCurrent(activeGeneration)) return
      error.value = reason instanceof ApiError ? reason.message : i18n.global.t(options.fallbackKey)
    } finally {
      if (generation.isCurrent(activeGeneration)) {
        if (append) loadingMore.value = false
        else loading.value = false
      }
    }
  }

  /** Drops everything and invalidates any open request, for a library switch. */
  function reset(): void {
    generation.invalidate()
    items.value = []
    total.value = 0
    page.value = 0
    loading.value = false
    loadingMore.value = false
    error.value = null
    initialized.value = false
  }

  return { items, total, page, loading, loadingMore, busy, error, initialized, hasMore, load, reset }
}

export type PodcastListLane<TItem> = ReturnType<typeof createPodcastListLane<TItem>>
