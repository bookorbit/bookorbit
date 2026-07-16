import { computed, ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { BookCard, BookQuery, BooksPage } from '@bookorbit/types'

const GLOBAL_SEARCH_PAGE_SIZE = 20
const GLOBAL_SEARCH_DEBOUNCE_MS = 300

export type GlobalSearchResult = BookCard

export function useGlobalSearch(query: Ref<string>) {
  const results = ref<GlobalSearchResult[]>([])
  const total = ref(0)
  const loading = ref(false)
  const loadingMore = ref(false)
  const settled = ref(false)
  const shelfmarkLoading = ref(false)
  const shelfmarkEnabled = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let shelfmarkController: AbortController | null = null
  let generation = 0
  let activeQuery = ''
  let nextPage = 0

  const hasMore = computed(() => results.value.length < total.value)

  // Fetch shelfmark settings on initialization
  async function initShelfmark() {
    try {
      const res = await api('/api/v1/user-preferences/shelfmark')
      if (res.ok) {
        const data = await res.json()
        shelfmarkEnabled.value = data.settings?.enabled ?? false
      }
    } catch {
      shelfmarkEnabled.value = false
    }
  }

  void initShelfmark()

  async function loadPage(q: string, page: number, append: boolean, gen: number) {
    const requestController = new AbortController()
    controller = requestController
    if (append) loadingMore.value = true
    else {
      loading.value = true
      settled.value = false
      if (shelfmarkEnabled.value && page === 0) {
        shelfmarkLoading.value = true
      }
    }

    try {
      const body: BookQuery = {
        q,
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page, size: GLOBAL_SEARCH_PAGE_SIZE },
      }
      const res = await api('/api/v1/books/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: requestController.signal,
      })
      if (gen !== generation) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data: BooksPage = await res.json()
      if (gen !== generation) return

      results.value = append ? [...results.value, ...data.items] : data.items
      total.value = data.total
      nextPage = data.page + 1

      if (!append && page === 0 && shelfmarkEnabled.value) {
        await loadShelfmark(q, gen)
      }
    } catch {
      if (gen !== generation || requestController.signal.aborted) return
      if (!append) {
        results.value = []
        total.value = 0
      }
    } finally {
      if (gen === generation) {
        loading.value = false
        loadingMore.value = false
        shelfmarkLoading.value = false
        settled.value = true
      }
    }
  }

  async function loadShelfmark(q: string, gen: number) {
    const requestController = new AbortController()
    shelfmarkController = requestController
    shelfmarkLoading.value = true

    try {
      const res = await api(`/api/v1/books/shelfmark?q=${encodeURIComponent(q)}`, {
        method: 'GET',
        signal: requestController.signal,
      })
      if (gen !== generation) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const externalItems: BookCard[] = await res.json()
      if (gen !== generation) return

      const existingIds = new Set(results.value.map((item) => item.id))
      const uniqueNewItems = externalItems.filter((item) => !existingIds.has(item.id))

      results.value = [...results.value, ...uniqueNewItems]
      total.value += uniqueNewItems.length
    } catch {
      // Ignore abort/errors, handle gracefully
    } finally {
      if (gen === generation) {
        shelfmarkLoading.value = false
      }
    }
  }

  watch(query, (q) => {
    if (timer) clearTimeout(timer)
    controller?.abort()
    shelfmarkController?.abort()
    generation += 1
    settled.value = false
    shelfmarkLoading.value = false
    activeQuery = q.trim()
    nextPage = 0
    results.value = []
    total.value = 0

    if (activeQuery.length < 2) {
      loading.value = false
      loadingMore.value = false
      return
    }

    loading.value = true
    const gen = generation
    timer = setTimeout(async () => {
      await loadPage(activeQuery, 0, false, gen)
    }, GLOBAL_SEARCH_DEBOUNCE_MS)
  })

  async function loadMore() {
    if (loading.value || loadingMore.value || !hasMore.value || activeQuery.length < 2) return
    await loadPage(activeQuery, nextPage, true, generation)
  }

  function clear() {
    if (timer) clearTimeout(timer)
    controller?.abort()
    shelfmarkController?.abort()
    generation += 1
    activeQuery = ''
    nextPage = 0
    results.value = []
    total.value = 0
    loading.value = false
    loadingMore.value = false
    shelfmarkLoading.value = false
    settled.value = false
  }

  return { results, total, loading, loadingMore, settled, hasMore, loadMore, clear, shelfmarkLoading, shelfmarkEnabled }
}
