import { computed, ref, type Ref } from 'vue'

import type { BookCard, SeriesDetail } from '@bookorbit/types'
import { fetchSeriesBooks } from '../api/series'
import type { SeriesBookSort, SortDirection } from '../types/series'

const PAGE_SIZE = 50
type LoadOptions = {
  reset?: boolean
  keepPreviousData?: boolean
}

export function useSeriesDetail(seriesId: Ref<number | null>) {
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

  let requestToken = 0

  async function load(input: boolean | LoadOptions = false): Promise<void> {
    const reset = typeof input === 'boolean' ? input : Boolean(input.reset)
    const keepPreviousData = typeof input === 'boolean' ? false : Boolean(input.keepPreviousData)
    const currentSeriesId = seriesId.value
    if (currentSeriesId == null) {
      requestToken++
      loading.value = false
      error.value = null
      notFound.value = true
      page.value = 0
      items.value = []
      seriesInfo.value = null
      total.value = 0
      return
    }
    if (!reset && loading.value) return
    if (!reset && !hasMore.value) return
    const requestPage = reset ? 0 : page.value

    const token = ++requestToken
    loading.value = true
    error.value = null

    if (reset) {
      notFound.value = false
      page.value = 0
      if (!keepPreviousData) {
        items.value = []
        seriesInfo.value = null
        total.value = 0
      }
    }

    try {
      const data = await fetchSeriesBooks(currentSeriesId, {
        page: requestPage,
        size: PAGE_SIZE,
        sort: sort.value,
        order: order.value,
        libraryId: libraryId.value,
      })

      if (token !== requestToken) return

      items.value = reset ? data.items : [...items.value, ...data.items]
      total.value = data.total
      seriesInfo.value = data.seriesInfo
      page.value = requestPage + 1
    } catch (err) {
      if (token !== requestToken) return
      if (err instanceof Error && err.message.includes('404')) {
        notFound.value = true
      } else {
        error.value = err instanceof Error ? err.message : 'Failed to load series'
      }
    } finally {
      if (token === requestToken) loading.value = false
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
