import { ref, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { BookCard } from '@projectx/types'

const PAGE_SIZE = 50

export function useCollectionBooks(collectionId: Ref<number>) {
  const items = ref<BookCard[]>([])
  const total = ref(0)
  const loading = ref(false)
  const initialized = ref(false)
  const hasMore = ref(false)
  let page = 0

  async function load(reset = false) {
    if (loading.value) return
    if (!reset && !hasMore.value) return
    if (reset) {
      page = 0
      items.value = []
    }
    loading.value = true
    try {
      const res = await api(`/api/v1/collections/${collectionId.value}/books?page=${page}&size=${PAGE_SIZE}`)
      if (!res.ok) throw new Error('Failed to load collection books')
      const data = await res.json()
      items.value = reset ? data.items : [...items.value, ...data.items]
      total.value = data.total
      hasMore.value = items.value.length < data.total
      page++
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  return { items, total, loading, initialized, hasMore, load }
}
