import { computed, ref, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { BookCard, BooksPage } from '@bookorbit/types'

const PAGE_SIZE = 50

export function useSmartScope(smartScopeId: Ref<number>, q: Ref<string> = ref('')) {
  const items = ref<BookCard[]>([])
  const total = ref(0)
  const loading = ref(false)
  const initialized = ref(false)
  const page = ref(0)

  const hasMore = computed(() => items.value.length < total.value)

  async function load(reset = false) {
    if (loading.value || !smartScopeId.value || isNaN(smartScopeId.value)) return
    loading.value = true

    if (reset) {
      page.value = 0
      items.value = []
    }

    try {
      const qParam = q.value.trim() ? `&q=${encodeURIComponent(q.value.trim())}` : ''
      const res = await api(`/api/v1/smart-scopes/${smartScopeId.value}/books?page=${page.value}&size=${PAGE_SIZE}${qParam}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data: BooksPage = await res.json()

      if (page.value === 0) {
        items.value = data.items
      } else {
        items.value = [...items.value, ...data.items]
      }
      total.value = data.total
      page.value++
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  return { items, total, loading, initialized, hasMore, load }
}
