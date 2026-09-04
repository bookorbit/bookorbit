import { computed, ref, type Ref } from 'vue'

import type { BookCard } from '@bookorbit/types'
import { fetchAuthorBooks } from '../api/author'
import type { AuthorBookSort, SortDirection } from '../types/author'

const PAGE_SIZE = 50

export function useAuthorBooks(authorId: Ref<number>) {
  const items = ref<BookCard[]>([])
  /** Rows, so it keeps matching `items` once a series arrives as a single collapsed card. */
  const total = ref(0)
  /** Books behind those rows. Equal to `total` while the list is flat. */
  const bookTotal = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const sort = ref<AuthorBookSort>('addedAt')
  const order = ref<SortDirection>('desc')
  const libraryId = ref<number | null>(null)
  const collapseSeries = ref(false)

  const page = ref(0)
  const hasMore = computed(() => items.value.length < total.value)

  /**
   * Set when a reset arrives while a request is in flight: the query changed under it, so the
   * pending response is stale and the list has to be rebuilt once that request settles.
   */
  let resetQueued = false

  async function load(reset = false): Promise<void> {
    if (!authorId.value || Number.isNaN(authorId.value)) return
    if (loading.value) {
      if (reset) resetQueued = true
      return
    }
    if (!reset && !hasMore.value) return

    loading.value = true
    error.value = null

    if (reset) {
      page.value = 0
      items.value = []
    }

    try {
      const data = await fetchAuthorBooks(authorId.value, {
        page: page.value,
        size: PAGE_SIZE,
        sort: sort.value,
        order: order.value,
        libraryId: libraryId.value,
        collapseSeries: collapseSeries.value,
      })

      // Dropped on purpose when a reset is queued: these rows answer the previous query.
      if (!resetQueued) {
        items.value = reset ? data.items : [...items.value, ...data.items]
        total.value = data.total
        bookTotal.value = data.bookTotal
        page.value += 1
      }
    } catch (err) {
      if (!resetQueued) error.value = err instanceof Error ? err.message : 'Failed to load books'
    } finally {
      loading.value = false
      if (resetQueued) {
        resetQueued = false
        void load(true)
      }
    }
  }

  return {
    items,
    total,
    bookTotal,
    loading,
    error,
    hasMore,
    sort,
    order,
    libraryId,
    collapseSeries,
    load,
  }
}
