import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { AnnotationItem, AnnotationListResponse, AnnotationStats } from '@bookorbit/types'
import { api } from '@/lib/api'
import { buildFilterChips } from '@/features/annotations/lib/filter-chips'
import { useAnnotationSelection } from '@/features/annotations/composables/useAnnotationSelection'
import { useAnnotationMutations } from '@/features/annotations/composables/useAnnotationMutations'
import { buildHighlightGroups, withLoadedItems, type HighlightGroupMode } from '@/features/book/lib/highlight-groups'

export type BookSortKey = 'position' | 'newest' | 'oldest'

const SEARCH_RELOAD_DEBOUNCE_MS = 300
/** The server caps pageSize at 100. A window this size covers most books in one request. */
const PAGE_SIZE = 100

export function useBookHighlights(bookIdRef: Ref<number>) {
  const items = ref<AnnotationItem[]>([])
  const total = ref(0)
  const loadedPages = ref(0)
  const stats = ref<AnnotationStats | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)

  const sortBy = ref<'position' | 'createdAt'>('position')
  const sortDir = ref<'asc' | 'desc'>('asc')
  const colors = ref<string[]>([])
  const search = ref('')
  const chapter = ref('')
  const dateFrom = ref('')
  const dateTo = ref('')
  const groupMode = ref<HighlightGroupMode>('chapter')
  const onlyNotes = ref(false)
  const onlyNeedsReview = ref(false)
  const activeId = ref<number | null>(null)
  const hydratingBook = ref(false)

  const selection = useAnnotationSelection(items)
  const mutations = useAnnotationMutations(items, () => bookIdRef.value)

  const chapters = computed(() => stats.value?.chapters ?? [])
  const hasMore = computed(() => items.value.length < total.value)

  /**
   * Client-only refinements of the loaded window. Both are cheap boolean reads on rows already
   * in memory, and neither exists as a server filter, so they deliberately do not reload.
   */
  const visibleItems = computed(() => {
    let visible = items.value
    if (onlyNotes.value) visible = visible.filter((item) => item.note != null && item.note !== '')
    if (onlyNeedsReview.value) visible = visible.filter((item) => item.positionStatus === 'failed' || item.positionStatus === 'repaired')
    return visible
  })

  const groups = computed(() => buildHighlightGroups(visibleItems.value, stats.value, groupMode.value))
  const streamGroups = computed(() => withLoadedItems(groups.value))
  const needsReviewCount = computed(() => items.value.filter((item) => item.positionStatus === 'failed' || item.positionStatus === 'repaired').length)
  const activeItem = computed(() => items.value.find((item) => item.id === activeId.value) ?? null)
  const activeIndex = computed(() => (activeId.value == null ? -1 : items.value.findIndex((item) => item.id === activeId.value)))

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

  function buildParams(page: number): URLSearchParams {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy: sortBy.value,
      sortDir: sortDir.value,
    })
    if (colors.value.length > 0) params.set('colors', colors.value.join(','))
    if (search.value.trim()) params.set('search', search.value.trim())
    if (chapter.value) params.set('chapter', chapter.value)
    if (dateFrom.value) params.set('dateFrom', dateFrom.value)
    if (dateTo.value) params.set('dateTo', dateTo.value)
    return params
  }

  let fetchSeq = 0
  /**
   * `silent` refetches without raising `loading`, so a revalidation behind an already-rendered
   * stream cannot flip the tab through its empty state on the way back.
   */
  async function fetchHighlights(opts?: { silent?: boolean }) {
    const bookId = bookIdRef.value
    const seq = ++fetchSeq
    if (!opts?.silent) loading.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/books/${bookId}/annotations?${buildParams(1).toString()}`)
      if (seq !== fetchSeq) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: AnnotationListResponse = await res.json()
      if (seq !== fetchSeq) return
      items.value = data.items
      total.value = data.total
      stats.value = data.stats
      loadedPages.value = 1
    } catch (e) {
      if (seq === fetchSeq) error.value = e instanceof Error ? e.message : 'Failed to load highlights'
    } finally {
      if (seq === fetchSeq) loading.value = false
    }
  }

  /** Appends the next window. The pager it replaces cost a round trip per 25 rows. */
  async function loadMore() {
    if (loadingMore.value || loading.value || !hasMore.value) return
    const bookId = bookIdRef.value
    const seq = fetchSeq
    loadingMore.value = true
    try {
      const res = await api(`/api/v1/books/${bookId}/annotations?${buildParams(loadedPages.value + 1).toString()}`)
      if (seq !== fetchSeq) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: AnnotationListResponse = await res.json()
      if (seq !== fetchSeq) return
      const known = new Set(items.value.map((item) => item.id))
      items.value = [...items.value, ...data.items.filter((item) => !known.has(item.id))]
      total.value = data.total
      stats.value = data.stats
      loadedPages.value += 1
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load highlights'
    } finally {
      loadingMore.value = false
    }
  }

  /**
   * Pulls fresh aggregates after a mutation without disturbing the loaded window. Mutations patch
   * `items` in place, so refetching the whole window would only cost a round trip and a scroll jump.
   */
  async function refreshStats() {
    try {
      const params = buildParams(1)
      params.set('pageSize', '1')
      const res = await api(`/api/v1/books/${bookIdRef.value}/annotations?${params.toString()}`)
      if (!res.ok) return
      const data: AnnotationListResponse = await res.json()
      stats.value = data.stats
      total.value = data.total
    } catch {
      /* the counts stay as they were; the list is still correct */
    }
  }

  function reloadFromFilterChange() {
    selection.clearSelection()
    activeId.value = null
    void fetchHighlights()
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
    onlyNotes.value = false
    onlyNeedsReview.value = false
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

  function toggleColorFilter(color: string) {
    colors.value = colors.value.includes(color) ? colors.value.filter((value) => value !== color) : [...colors.value, color]
  }

  function setChapterFilter(title: string | null) {
    chapter.value = chapter.value === title ? '' : (title ?? '')
  }

  async function deleteHighlight(annotationId: number) {
    const bookId = bookIdRef.value
    const prev = items.value
    const prevTotal = total.value
    items.value = items.value.filter((a) => a.id !== annotationId)
    total.value = Math.max(0, total.value - 1)
    if (activeId.value === annotationId) activeId.value = null
    try {
      const res = await api(`/api/v1/books/${bookId}/annotations/${annotationId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await refreshStats()
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
    const removed = new Set(annotationIds)
    items.value = items.value.filter((a) => !removed.has(a.id))
    total.value = Math.max(0, total.value - annotationIds.length)
    if (activeId.value != null && removed.has(activeId.value)) activeId.value = null
    try {
      const res = await api('/api/v1/annotations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: annotationIds, action: 'trash' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { affected: number }
      await refreshStats()
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
    const prev = items.value
    const touched = new Set(annotationIds)
    items.value = items.value.map((item) => (touched.has(item.id) ? { ...item, ...patch } : item))
    try {
      const res = await api('/api/v1/annotations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: annotationIds, action: 'restyle', ...patch }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { affected: number }
      await refreshStats()
      return body.affected
    } catch (e) {
      items.value = prev
      error.value = e instanceof Error ? e.message : 'Failed to update selected highlights'
      return 0
    }
  }

  function openInspector(annotationId: number) {
    activeId.value = annotationId
  }

  function closeInspector() {
    activeId.value = null
  }

  function stepInspector(delta: number) {
    const list = visibleItems.value
    if (list.length === 0) return
    const current = activeId.value == null ? -1 : list.findIndex((item) => item.id === activeId.value)
    const next = Math.min(list.length - 1, Math.max(0, current + delta))
    const target = list[next]
    if (target) activeId.value = target.id
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

  watch(
    bookIdRef,
    () => {
      hydratingBook.value = true
      colors.value = []
      search.value = ''
      chapter.value = ''
      dateFrom.value = ''
      dateTo.value = ''
      onlyNotes.value = false
      onlyNeedsReview.value = false
      activeId.value = null
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
    visibleItems,
    total,
    stats,
    groups,
    streamGroups,
    groupMode,
    loading,
    loadingMore,
    hasMore,
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
    onlyNotes,
    onlyNeedsReview,
    needsReviewCount,
    activeId,
    activeItem,
    activeIndex,
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
    loadMore,
    deleteHighlight,
    bulkTrash,
    bulkRestyle,
    clearPopoverFilters,
    resetAllFilters,
    removeFilterChip,
    toggleColorFilter,
    setChapterFilter,
    clearDates,
    openInspector,
    closeInspector,
    stepInspector,
  }
}
