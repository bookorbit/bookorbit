import { ref, watch, type Ref } from 'vue'
import type { BookReadingSession, BookReadingSessionListResponse, BookReadingSessionStats, KoboReadingSessionEntry } from '@bookorbit/types'
import { api } from '@/lib/api'

export function useBookReadingLog(bookIdRef: Ref<number>) {
  const sessions = ref<BookReadingSession[]>([])
  const total = ref(0)
  const stats = ref<BookReadingSessionStats | null>(null)
  const koboReadingState = ref<KoboReadingSessionEntry | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(1)
  const pageSize = ref(25)
  const sortBy = ref<'startedAt' | 'durationSeconds' | 'progressDelta' | 'endProgress'>('startedAt')
  const sortDir = ref<'asc' | 'desc'>('desc')
  const dateFrom = ref<string | undefined>(undefined)
  const dateTo = ref<string | undefined>(undefined)
  const format = ref<string | undefined>(undefined)

  async function fetchSessions() {
    const bookId = bookIdRef.value
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams({
        page: String(page.value),
        pageSize: String(pageSize.value),
        sortBy: sortBy.value,
        sortDir: sortDir.value,
      })
      if (dateFrom.value) params.set('dateFrom', dateFrom.value)
      if (dateTo.value) params.set('dateTo', dateTo.value)
      if (format.value) params.set('format', format.value)
      const res = await api(`/api/v1/books/${bookId}/sessions?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: BookReadingSessionListResponse = await res.json()
      sessions.value = data.items
      total.value = data.total
      stats.value = data.stats
      koboReadingState.value = data.koboReadingState ?? null
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load reading sessions'
    } finally {
      loading.value = false
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
      await fetchSessions()
    } catch (e) {
      sessions.value = prev
      total.value = prevTotal
      error.value = e instanceof Error ? e.message : 'Failed to delete session'
    }
  }

  function setPage(p: number) {
    page.value = p
    void fetchSessions()
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
    koboReadingState,
    loading,
    error,
    page,
    pageSize,
    sortBy,
    sortDir,
    dateFrom,
    dateTo,
    format,
    deleteSession,
    setPage,
    setSort,
    setFilters,
  }
}
