import { computed, ref, watch, type Ref } from 'vue'
import type { BookReadingSession, BookReadingSessionListResponse, BookReadingSessionStats } from '@bookorbit/types'
import { api } from '@/lib/api'

export interface AddReadingSessionPayload {
  startedAt: string
  durationMinutes: number
  endProgress?: number
  format?: string
}

const EXPORT_PAGE_SIZE = 100
const EXPORT_MAX_PAGES = 50

export function useBookReadingLog(bookIdRef: Ref<number>) {
  const sessions = ref<BookReadingSession[]>([])
  const total = ref(0)
  const stats = ref<BookReadingSessionStats | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  const page = ref(1)
  const pageSize = ref(25)
  const sortBy = ref<'startedAt' | 'durationSeconds' | 'progressDelta' | 'endProgress'>('startedAt')
  const sortDir = ref<'asc' | 'desc'>('desc')
  const dateFrom = ref<string | undefined>(undefined)
  const dateTo = ref<string | undefined>(undefined)
  const format = ref<string | undefined>(undefined)

  const hasMore = computed(() => sessions.value.length < total.value)

  function buildParams(overrides?: { page?: number; pageSize?: number }) {
    const params = new URLSearchParams({
      page: String(overrides?.page ?? page.value),
      pageSize: String(overrides?.pageSize ?? pageSize.value),
      sortBy: sortBy.value,
      sortDir: sortDir.value,
    })
    if (dateFrom.value) params.set('dateFrom', dateFrom.value)
    if (dateTo.value) params.set('dateTo', dateTo.value)
    if (format.value) params.set('format', format.value)
    return params
  }

  async function fetchSessions(opts?: { append?: boolean }) {
    const bookId = bookIdRef.value
    const append = opts?.append ?? false
    if (append) loadingMore.value = true
    else loading.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/books/${bookId}/sessions?${buildParams().toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: BookReadingSessionListResponse = await res.json()
      if (append) {
        const seen = new Set(sessions.value.map((s) => s.id))
        sessions.value = [...sessions.value, ...data.items.filter((item) => !seen.has(item.id))]
      } else {
        sessions.value = data.items
      }
      total.value = data.total
      stats.value = data.stats
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load reading sessions'
    } finally {
      loading.value = false
      loadingMore.value = false
    }
  }

  async function loadMore() {
    if (loading.value || loadingMore.value || !hasMore.value) return
    // Derive the next page from the accumulated length so a prior delete
    // (which shifts server page boundaries) cannot skip rows.
    page.value = Math.floor(sessions.value.length / pageSize.value) + 1
    await fetchSessions({ append: true })
  }

  async function refreshStats() {
    const bookId = bookIdRef.value
    try {
      const res = await api(`/api/v1/books/${bookId}/sessions?${buildParams({ page: 1, pageSize: 1 }).toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: BookReadingSessionListResponse = await res.json()
      total.value = data.total
      stats.value = data.stats
    } catch {
      // Stats refresh is best-effort; the optimistic list update already happened.
    }
  }

  async function deleteSession(sessionId: number) {
    const bookId = bookIdRef.value
    const prev = sessions.value
    const prevTotal = total.value
    sessions.value = sessions.value.filter((s) => s.id !== sessionId)
    total.value = Math.max(0, total.value - 1)
    try {
      const res = await api(`/api/v1/books/${bookId}/sessions/${sessionId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await refreshStats()
    } catch (e) {
      sessions.value = prev
      total.value = prevTotal
      error.value = e instanceof Error ? e.message : 'Failed to delete session'
    }
  }

  async function addSession(payload: AddReadingSessionPayload) {
    const bookId = bookIdRef.value
    const res = await api(`/api/v1/books/${bookId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      let message = `HTTP ${res.status}`
      try {
        const body = (await res.json()) as { message?: string | string[] }
        if (body.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message
      } catch {
        // Keep the HTTP status message.
      }
      throw new Error(message)
    }
    page.value = 1
    await fetchSessions()
  }

  async function exportAll(): Promise<BookReadingSession[]> {
    const bookId = bookIdRef.value
    const items: BookReadingSession[] = []
    let expectedTotal = Number.POSITIVE_INFINITY
    for (let exportPage = 1; exportPage <= EXPORT_MAX_PAGES && items.length < expectedTotal; exportPage += 1) {
      const params = buildParams({ page: exportPage, pageSize: EXPORT_PAGE_SIZE })
      params.set('sortBy', 'startedAt')
      params.set('sortDir', 'desc')
      const res = await api(`/api/v1/books/${bookId}/sessions?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: BookReadingSessionListResponse = await res.json()
      items.push(...data.items)
      expectedTotal = data.total
      if (data.items.length === 0) break
    }
    return items
  }

  function setSort(by: typeof sortBy.value, dir: typeof sortDir.value) {
    sortBy.value = by
    sortDir.value = dir
    page.value = 1
    void fetchSessions()
  }

  function setFilters(opts: { dateFrom?: string; dateTo?: string; format?: string }) {
    dateFrom.value = opts.dateFrom
    dateTo.value = opts.dateTo
    format.value = opts.format
    page.value = 1
    void fetchSessions()
  }

  watch(
    bookIdRef,
    () => {
      page.value = 1
      dateFrom.value = undefined
      dateTo.value = undefined
      format.value = undefined
      void fetchSessions()
    },
    { immediate: true },
  )

  return {
    sessions,
    total,
    stats,
    loading,
    loadingMore,
    error,
    page,
    pageSize,
    sortBy,
    sortDir,
    dateFrom,
    dateTo,
    format,
    hasMore,
    deleteSession,
    addSession,
    exportAll,
    loadMore,
    setSort,
    setFilters,
  }
}
