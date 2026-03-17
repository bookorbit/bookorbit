import { computed, ref } from 'vue'

import type { AuthorSummary } from '@projectx/types'
import { fetchAuthors } from '../api/author'
import type { AuthorListSort, SortDirection } from '../types/author'

const PAGE_SIZE = 50

export function useAuthorsList() {
  const items = ref<AuthorSummary[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const q = ref('')
  const sort = ref<AuthorListSort>('name')
  const order = ref<SortDirection>('asc')
  const libraryId = ref<number | null>(null)
  const hasPhoto = ref<boolean | null>(null)
  const minBookCount = ref<number | null>(null)

  const page = ref(0)
  const hasMore = computed(() => items.value.length < total.value)

  async function load(reset = false): Promise<void> {
    if (loading.value) return
    if (!reset && !hasMore.value) return

    loading.value = true
    error.value = null

    if (reset) {
      page.value = 0
      items.value = []
    }

    try {
      const data = await fetchAuthors({
        q: q.value.trim() || undefined,
        page: page.value,
        size: PAGE_SIZE,
        sort: sort.value,
        order: order.value,
        libraryId: libraryId.value,
        hasPhoto: hasPhoto.value,
        minBookCount: minBookCount.value,
      })

      items.value = reset ? data.items : [...items.value, ...data.items]
      total.value = data.total
      page.value += 1
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load authors'
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
    q,
    sort,
    order,
    libraryId,
    hasPhoto,
    minBookCount,
    load,
  }
}
