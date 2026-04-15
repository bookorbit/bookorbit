import { computed, ref, type Ref } from 'vue'

import type { BookCard, SeriesDetail } from '@projectx/types'
import { fetchSeriesBooks } from '../api/series'
import type { SeriesBookSort, SortDirection } from '../types/series'

const PAGE_SIZE = 50

export function useSeriesDetail(seriesName: Ref<string>) {
  const seriesInfo = ref<SeriesDetail | null>(null)
  const items = ref<BookCard[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const notFound = ref(false)

  const sort = ref<SeriesBookSort>('seriesIndex')
  const order = ref<SortDirection>('asc')
  const libraryId = ref<number | null>(null)

  const page = ref(0)
  const hasMore = computed(() => items.value.length < total.value)

  async function load(reset = false): Promise<void> {
    if (!seriesName.value) return
    if (loading.value) return
    if (!reset && !hasMore.value) return

    loading.value = true
    error.value = null

    if (reset) {
      page.value = 0
      items.value = []
      seriesInfo.value = null
      total.value = 0
      notFound.value = false
    }

    try {
      const data = await fetchSeriesBooks(seriesName.value, {
        page: page.value,
        size: PAGE_SIZE,
        sort: sort.value,
        order: order.value,
        libraryId: libraryId.value,
      })

      items.value = reset ? data.items : [...items.value, ...data.items]
      total.value = data.total
      seriesInfo.value = data.seriesInfo
      page.value += 1
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) {
        notFound.value = true
      } else {
        error.value = err instanceof Error ? err.message : 'Failed to load series'
      }
    } finally {
      loading.value = false
    }
  }

  return {
    seriesInfo,
    items,
    total,
    loading,
    error,
    notFound,
    hasMore,
    sort,
    order,
    libraryId,
    load,
  }
}
