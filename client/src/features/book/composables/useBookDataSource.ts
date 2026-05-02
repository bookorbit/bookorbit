import { computed, ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { BookCard, BookQuery, BooksPage, SortSpec } from '@bookorbit/types'

const PAGE_SIZE = 50

export type BookDataSourceOptions = {
  collapseEnabled?: Ref<boolean>
  q?: Ref<string>
  sort?: Ref<SortSpec[]>
}

function isValidScopeId(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

export function useBookDataSource(scopeId: Ref<number>, endpointForId: (id: number) => string, options: BookDataSourceOptions = {}) {
  const collapseEnabled = options.collapseEnabled ?? ref(false)
  const q = options.q ?? ref('')
  const sort = options.sort ?? ref<SortSpec[]>([{ field: 'title', dir: 'asc' }])

  const items = ref<BookCard[]>([])
  const total = ref(0)
  const loading = ref(false)
  const initialized = ref(false)
  const error = ref<string | null>(null)
  const page = ref(0)

  const hasMore = computed(() => items.value.length < total.value)

  let activeController: AbortController | null = null

  async function load(reset = false) {
    if (!isValidScopeId(scopeId.value)) {
      clear()
      initialized.value = true
      return
    }

    if (!reset && (loading.value || !hasMore.value)) return

    if (reset && activeController) {
      activeController.abort()
    }

    const controller = new AbortController()
    activeController = controller
    loading.value = true
    error.value = null

    if (reset) {
      page.value = 0
    }

    try {
      const body: BookQuery = {
        sort: sort.value,
        pagination: { page: page.value, size: PAGE_SIZE },
        ...(collapseEnabled.value ? { collapseSeries: true } : {}),
        ...(q.value.trim() ? { q: q.value.trim() } : {}),
      }
      const res = await api(endpointForId(scopeId.value), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (controller.signal.aborted) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data: BooksPage = await res.json()
      if (controller.signal.aborted) return

      items.value = page.value === 0 ? data.items : [...items.value, ...data.items]
      total.value = data.total
      page.value += 1
    } catch (e) {
      if (controller.signal.aborted) return
      error.value = e instanceof Error ? e.message : 'Failed to load books'
    } finally {
      if (!controller.signal.aborted) {
        loading.value = false
        initialized.value = true
      }
    }
  }

  function clear() {
    activeController?.abort()
    activeController = null
    items.value = []
    total.value = 0
    page.value = 0
    error.value = null
  }

  watch(
    sort,
    () => {
      void load(true)
    },
    { deep: true },
  )

  watch(collapseEnabled, () => {
    void load(true)
  })

  return { items, total, loading, initialized, error, hasMore, load, clear }
}
