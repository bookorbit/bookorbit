import { computed, ref } from 'vue'

import type { SeriesSummary } from '@bookorbit/types'
import { fetchSeries } from '../api/series'
import type { CompletionStatus, SeriesListSort, SortDirection } from '../types/series'

const PAGE_SIZE = 50

export function useSeriesList() {
  const items = ref<SeriesSummary[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const q = ref('')
  const sort = ref<SeriesListSort>('name')
  const order = ref<SortDirection>('asc')
  const libraryId = ref<number | null>(null)
  const completionStatus = ref<CompletionStatus | null>(null)
  const author = ref<string | null>(null)

  const page = ref(0)
  const hasMore = computed(() => items.value.length < total.value)

  let requestToken = 0

  async function load(reset = false): Promise<void> {
    if (!reset && loading.value) return
    if (!reset && !hasMore.value) return

    const token = ++requestToken
    loading.value = true
    error.value = null

    const requestPage = reset ? 0 : page.value
    if (reset) {
      page.value = 0
      items.value = []
    }

    try {
      const data = await fetchSeries({
        q: q.value.trim() || undefined,
        page: requestPage,
        size: PAGE_SIZE,
        sort: sort.value,
        order: order.value,
        libraryId: libraryId.value,
        completionStatus: completionStatus.value,
        author: author.value?.trim() || undefined,
      })

      if (token !== requestToken) return

      items.value = reset ? data.items : [...items.value, ...data.items]
      total.value = data.total
      page.value = requestPage + 1
    } catch (err) {
      if (token !== requestToken) return
      error.value = err instanceof Error ? err.message : 'Failed to load series'
    } finally {
      if (token === requestToken) loading.value = false
    }
  }

  return {
    items,
    total,
    loading,
    error,
    hasMore,
    q,
    sort,
    order,
    libraryId,
    completionStatus,
    author,
    load,
  }
}
