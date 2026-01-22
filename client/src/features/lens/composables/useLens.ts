import { computed, ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { BookCard, BooksPage } from '@projectx/types'

const PAGE_SIZE = 50

export function useLens(lensId: Ref<number>) {
  const items = ref<BookCard[]>([])
  const total = ref(0)
  const loading = ref(false)
  const page = ref(0)

  const hasMore = computed(() => items.value.length < total.value)

  async function load(reset = false) {
    if (loading.value) return
    loading.value = true

    if (reset) {
      page.value = 0
      items.value = []
    }

    try {
      const res = await api(`/api/lenses/${lensId.value}/books?page=${page.value}&size=${PAGE_SIZE}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data: BooksPage = await res.json()

      if (page.value === 0) {
        items.value = data.items
      } else {
        items.value.push(...data.items)
      }
      total.value = data.total
      page.value++
    } finally {
      loading.value = false
    }
  }

  watch(lensId, () => load(true))

  return { items, total, loading, hasMore, load }
}
