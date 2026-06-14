import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { AnnotationItem, AnnotationListResponse, AnnotationStats } from '@bookorbit/types'
import { api } from '@/lib/api'
import { buildFilterChips } from '@/features/annotations/lib/filter-chips'
import { useAnnotationSelection } from '@/features/annotations/composables/useAnnotationSelection'
import { useAnnotationMutations } from '@/features/annotations/composables/useAnnotationMutations'

export type BookSortKey = 'position' | 'newest' | 'oldest'

const SEARCH_RELOAD_DEBOUNCE_MS = 300

export function useBookHighlights(bookIdRef: Ref<number>) {
  const items = ref<AnnotationItem[]>([])
  const total = ref(0)
  const pageSize = ref(25)
  const page = ref(1)
  const stats = ref<AnnotationStats | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const sortBy = ref<'position' | 'createdAt'>('position')
  const sortDir = ref<'asc' | 'desc'>('asc')
  const colors = ref<string[]>([])
  const search = ref('')
  const chapter = ref('')
  const dateFrom = ref('')
  const dateTo = ref('')
  const hydratingBook = ref(false)

  const selection = useAnnotationSelection(items)
  const mutations = useAnnotationMutations(items, () => bookIdRef.value)

  const chapters = computed(() => stats.value?.chapters ?? [])
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const rangeStart = computed(() => (total.value === 0 ? 0 : Math.min((page.value - 1) * pageSize.value + 1, total.value)))
  const rangeEnd = computed(() => Math.min(page.value * pageSize.value, total.value))

  const sortKey = computed<BookSortKey>({
    get() {
      if (sortBy.value === 'position') return 'position'
      return sortDir.value === 'desc' ? 'newest' : 'oldest'
    },
    set(value) {
      if (value === 'position') {
        sortBy.value = 'position'
        sortDir.value = 'asc'
      } else {
        sortBy.value = 'createdAt'
        sortDir.value = value === 'newest' ? 'desc' : 'asc'
      }
    },
  })

  const activeFilterChips = computed(() => buildFilterChips({ colors: colors.value, dateFrom: dateFrom.value, dateTo: dateTo.value }))
  const popoverFilterCount = computed(() => activeFilterChips.value.length)
  const hasActiveFilters = computed(
    () => search.value.trim() !== '' || colors.value.length > 0 || Boolean(chapter.value) || dateFrom.value !== '' || dateTo.value !== '',
  )

  let fetchSeq = 0
  async function fetchHighlights() {
    const bookId = bookIdRef.value
    const seq = ++fetchSeq
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
      if (seq !== fetchSeq) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: AnnotationListResponse = await res.json()
      if (seq !== fetchSeq) return
      items.value = data.items
      total.value = data.total
      stats.value = data.stats
    } catch (e) {
      if (seq === fetchSeq) error.value = e instanceof Error ? e.message : 'Failed to load highlights'
    } finally {
      if (seq === fetchSeq) loading.value = false
    }
  }

  function reloadFromFilterChange() {
    selection.clearSelection()
    if (page.value === 1) void fetchHighlights()
    else page.value = 1
  }

  function clearDates() {
    dateFrom.value = ''
    dateTo.value = ''
  }

  function clearPopoverFilters() {
    colors.value = []
    clearDates()
  }

  function resetAllFilters() {
    search.value = ''
    chapter.value = ''
    clearPopoverFilters()
  }

  function removeFilterChip(id: string) {
    if (id.startsWith('color:')) {
      const hex = id.slice('color:'.length)
      colors.value = colors.value.filter((value) => value !== hex)
      return
    }
    if (id === 'date') clearDates()
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

  watch([colors, chapter, dateFrom, dateTo, sortBy, sortDir], () => {
    if (hydratingBook.value) return
    reloadFromFilterChange()
  })
  let searchDebounce: ReturnType<typeof setTimeout> | null = null
  watch(search, () => {
    if (hydratingBook.value) return
    if (searchDebounce) clearTimeout(searchDebounce)
    searchDebounce = setTimeout(reloadFromFilterChange, SEARCH_RELOAD_DEBOUNCE_MS)
  })
  watch(page, () => {
    if (hydratingBook.value) return
    selection.clearSelection()
    void fetchHighlights()
  })

  watch(
    bookIdRef,
    () => {
      hydratingBook.value = true
      page.value = 1
      colors.value = []
      search.value = ''
      chapter.value = ''
      dateFrom.value = ''
      dateTo.value = ''
      sortBy.value = 'position'
      sortDir.value = 'asc'
      void fetchHighlights()
      void nextTick(() => {
        hydratingBook.value = false
      })
    },
    { immediate: true },
  )

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    rangeStart,
    rangeEnd,
    stats,
    loading,
    error,
    sortBy,
    sortDir,
    sortKey,
    colors,
    search,
    chapter,
    chapters,
    dateFrom,
    dateTo,
    activeFilterChips,
    popoverFilterCount,
    hasActiveFilters,
    selectedIds: selection.selectedIds,
    savingIds: mutations.savingIds,
    hasSelection: selection.hasSelection,
    allVisibleSelected: selection.allVisibleSelected,
    selectedItems: selection.selectedItems,
    toggleSelected: selection.toggleSelected,
    selectAllOnPage: selection.selectAllOnPage,
    clearSelection: selection.clearSelection,
    updateNote: mutations.updateNote,
    updateColor: mutations.updateColor,
    updateStyle: mutations.updateStyle,
    fetchHighlights,
    deleteHighlight,
    bulkTrash,
    bulkRestyle,
    clearPopoverFilters,
    resetAllFilters,
    removeFilterChip,
    clearDates,
  }
}
