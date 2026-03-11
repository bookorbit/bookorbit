import { computed, reactive, ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { BookCard, BookQuery, BooksPage, GroupRule, SortSpec } from '@projectx/types'

export type { BookCard }

export function useBookQuery(libraryId: Ref<number | null>) {
  const items = ref<BookCard[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const filter = ref<GroupRule | undefined>(undefined)
  const sort = ref<SortSpec[]>([{ field: 'title', dir: 'asc' }])
  const pagination = reactive({ page: 0, size: 50 })

  const hasMore = computed(() => items.value.length < total.value)

  async function load(reset = false) {
    if (loading.value || libraryId.value === null) return
    loading.value = true
    error.value = null

    if (reset) {
      pagination.page = 0
      items.value = []
    }

    try {
      const body: BookQuery = {
        filter: filter.value,
        sort: sort.value,
        pagination: { page: pagination.page, size: pagination.size },
      }

      const res = await api(`/api/v1/libraries/${libraryId.value}/books`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const page: BooksPage = await res.json()

      if (pagination.page === 0) {
        items.value = page.items
      } else {
        items.value = [...items.value, ...page.items]
      }
      total.value = page.total
      pagination.page++
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load books'
    } finally {
      loading.value = false
    }
  }

  function clear() {
    items.value = []
    total.value = 0
    pagination.page = 0
  }

  watch(libraryId, (newId, oldId) => {
    if (newId !== oldId) load(true)
  })

  return { items, total, loading, error, filter, sort, pagination, hasMore, load, clear }
}
