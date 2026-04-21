import { computed, ref, type Ref } from 'vue'

import type { BookCard } from '@bookorbit/types'
import { fetchAuthorBooks } from '../api/author'
import type { AuthorBookSort, SortDirection } from '../types/author'

const PAGE_SIZE = 50

export function useAuthorBooks(authorId: Ref<number>) {
  const items = ref<BookCard[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const sort = ref<AuthorBookSort>('addedAt')
  const order = ref<SortDirection>('desc')
  const libraryId = ref<number | null>(null)

  const page = ref(0)
  const hasMore = computed(() => items.value.length < total.value)

  async function load(reset = false): Promise<void> {
    if (!authorId.value || Number.isNaN(authorId.value)) return
    if (loading.value) return
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
      })

      items.value = reset ? data.items : [...items.value, ...data.items]
      total.value = data.total
      page.value += 1
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load books'
    } finally {
      loading.value = false
    }
  }

  return {
    items,
    total,
    loading,
    error,
    hasMore,
    sort,
    order,
    libraryId,
    load,
  }
}
