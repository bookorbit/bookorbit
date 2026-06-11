import { computed, ref, watch, type Ref } from 'vue'
import type { AnnotationItem, AnnotationListResponse, AnnotationStats } from '@bookorbit/types'
import { api } from '@/lib/api'

export function useBookHighlights(bookIdRef: Ref<number>) {
  const items = ref<AnnotationItem[]>([])
  const total = ref(0)
  const stats = ref<AnnotationStats | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(1)
  const pageSize = ref(25)
  const sortBy = ref<'position' | 'createdAt'>('position')
  const sortDir = ref<'asc' | 'desc'>('asc')
  const colors = ref<string[]>([])
  const search = ref('')
  const chapter = ref<string | undefined>(undefined)
  const dateFrom = ref<string | undefined>(undefined)
  const dateTo = ref<string | undefined>(undefined)

  async function fetchHighlights() {
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
      if (colors.value.length > 0) params.set('colors', colors.value.join(','))
      if (search.value.trim()) params.set('search', search.value.trim())
      if (chapter.value) params.set('chapter', chapter.value)
      if (dateFrom.value) params.set('dateFrom', dateFrom.value)
      if (dateTo.value) params.set('dateTo', dateTo.value)

      const res = await api(`/api/v1/books/${bookId}/annotations?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: AnnotationListResponse = await res.json()
      items.value = data.items
      total.value = data.total
      stats.value = data.stats
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load highlights'
    } finally {
      loading.value = false
    }
  }

  async function updateNote(annotationId: number, note: string | null) {
    try {
      const bookId = bookIdRef.value
      const res = await api(`/api/v1/books/${bookId}/annotations/${annotationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated: AnnotationItem = await res.json()
      items.value = items.value.map((a) => (a.id === annotationId ? updated : a))
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update note'
    }
  }

  async function updateColor(annotationId: number, color: string) {
    try {
      const bookId = bookIdRef.value
      const res = await api(`/api/v1/books/${bookId}/annotations/${annotationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated: AnnotationItem = await res.json()
      items.value = items.value.map((a) => (a.id === annotationId ? updated : a))
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update color'
    }
  }

  async function updateStyle(annotationId: number, style: string) {
    try {
      const bookId = bookIdRef.value
      const res = await api(`/api/v1/books/${bookId}/annotations/${annotationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated: AnnotationItem = await res.json()
      items.value = items.value.map((a) => (a.id === annotationId ? updated : a))
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update style'
    }
  }

  async function deleteHighlight(annotationId: number) {
    const bookId = bookIdRef.value
    const prev = items.value
    const prevTotal = total.value
    items.value = items.value.filter((a) => a.id !== annotationId)
    total.value = Math.max(0, total.value - 1)
    try {
      const res = await api(`/api/v1/books/${bookId}/annotations/${annotationId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await fetchHighlights()
    } catch (e) {
      items.value = prev
      total.value = prevTotal
      error.value = e instanceof Error ? e.message : 'Failed to delete highlight'
    }
  }

  async function bulkTrash(annotationIds: number[]): Promise<number> {
    if (annotationIds.length === 0) return 0
    const prev = items.value
    const prevTotal = total.value
    items.value = items.value.filter((a) => !annotationIds.includes(a.id))
    total.value = Math.max(0, total.value - annotationIds.length)
    try {
      const res = await api('/api/v1/annotations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: annotationIds, action: 'trash' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { affected: number }
      await fetchHighlights()
      return body.affected
    } catch (e) {
      items.value = prev
      total.value = prevTotal
      error.value = e instanceof Error ? e.message : 'Failed to move highlights to trash'
      return 0
    }
  }

  async function bulkRestyle(annotationIds: number[], patch: { color?: string; style?: string }): Promise<number> {
    if (annotationIds.length === 0) return 0
    try {
      const res = await api('/api/v1/annotations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: annotationIds, action: 'restyle', ...patch }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { affected: number }
      await fetchHighlights()
      return body.affected
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update selected highlights'
      return 0
    }
  }

  function setPage(p: number) {
    page.value = p
    void fetchHighlights()
  }

  function setSort(by: typeof sortBy.value, dir: typeof sortDir.value) {
    sortBy.value = by
    sortDir.value = dir
    page.value = 1
    void fetchHighlights()
  }

  function toggleColor(color: string) {
    if (colors.value.includes(color)) {
      colors.value = colors.value.filter((c) => c !== color)
    } else {
      colors.value = [...colors.value, color]
    }
    page.value = 1
    void fetchHighlights()
  }

  function setSearch(q: string) {
    search.value = q
    page.value = 1
    void fetchHighlights()
  }

  function setChapter(ch: string | undefined) {
    chapter.value = ch
    page.value = 1
    void fetchHighlights()
  }

  function setDateRange(from: string | undefined, to: string | undefined) {
    dateFrom.value = from
    dateTo.value = to
    page.value = 1
    void fetchHighlights()
  }

  watch(
    bookIdRef,
    () => {
      page.value = 1
      colors.value = []
      search.value = ''
      chapter.value = undefined
      dateFrom.value = undefined
      dateTo.value = undefined
      void fetchHighlights()
    },
    { immediate: true },
  )

  const chapters = computed(() => stats.value?.chapters ?? [])

  return {
    items,
    total,
    stats,
    loading,
    error,
    page,
    pageSize,
    sortBy,
    sortDir,
    colors,
    search,
    chapter,
    chapters,
    dateFrom,
    dateTo,
    fetchHighlights,
    updateNote,
    updateColor,
    updateStyle,
    deleteHighlight,
    bulkTrash,
    bulkRestyle,
    setPage,
    setSort,
    toggleColor,
    setSearch,
    setChapter,
    setDateRange,
  }
}
