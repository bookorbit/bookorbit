import { computed, nextTick, ref, watch } from 'vue'
import type { AnnotationHubBookFacet, AnnotationHubItem, AnnotationHubResponse, AnnotationHubStats } from '@bookorbit/types'
import { api } from '@/lib/api'
import { type SortKey } from '../lib/filter-options'
import { buildFilterChips } from '../lib/filter-chips'
import { useAnnotationSelection } from './useAnnotationSelection'
import { useAnnotationMutations } from './useAnnotationMutations'

export type HubStatus = 'active' | 'trashed'

/** The slice of hub state that can be restored from the URL on load. */
export interface AnnotationsHubState {
  status: HubStatus
  search: string
  bookFilter: number | 'all'
  colors: string[]
  styleFilter: string
  originFilter: string
  notesOnly: boolean
  dateFrom: string
  dateTo: string
  sortKey: SortKey
  page: number
}

const SEARCH_RELOAD_DEBOUNCE_MS = 300

/**
 * Turns a yyyy-mm-dd value from an `<input type="date">` into a UTC ISO instant at the
 * start or end of that calendar day in the user's local timezone, so a "to" date includes
 * the whole day. Returns '' for empty or unparseable input.
 */
function toDayBoundaryIso(date: string, edge: 'start' | 'end'): string {
  if (!date) return ''
  const parsed = new Date(`${date}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

export function useAnnotationsHub() {
  const items = ref<AnnotationHubItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(25)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const status = ref<HubStatus>('active')
  const search = ref('')
  const colors = ref<string[]>([])
  const styleFilter = ref('all')
  const originFilter = ref('all')
  const bookFilter = ref<number | 'all'>('all')
  const sortBy = ref<'createdAt' | 'book'>('createdAt')
  const sortDir = ref<'asc' | 'desc'>('desc')
  const dateFrom = ref('')
  const dateTo = ref('')
  const notesOnly = ref(false)
  const hydrating = ref(false)

  const selectedBookLabel = ref<string | null>(null)
  const stats = ref<AnnotationHubStats | null>(null)

  const selection = useAnnotationSelection(items)
  const mutations = useAnnotationMutations(items, (id) => items.value.find((item) => item.id === id)?.bookId ?? null)

  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const rangeStart = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1))
  const rangeEnd = computed(() => Math.min(page.value * pageSize.value, total.value))

  const sortKey = computed<SortKey>({
    get() {
      if (sortBy.value === 'book') return sortDir.value === 'asc' ? 'book-asc' : 'book-desc'
      return sortDir.value === 'desc' ? 'newest' : 'oldest'
    },
    set(value) {
      switch (value) {
        case 'newest':
          sortBy.value = 'createdAt'
          sortDir.value = 'desc'
          break
        case 'oldest':
          sortBy.value = 'createdAt'
          sortDir.value = 'asc'
          break
        case 'book-asc':
          sortBy.value = 'book'
          sortDir.value = 'asc'
          break
        case 'book-desc':
          sortBy.value = 'book'
          sortDir.value = 'desc'
          break
      }
    },
  })

  const activeFilterChips = computed(() =>
    buildFilterChips({
      colors: colors.value,
      styleFilter: styleFilter.value,
      originFilter: originFilter.value,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
    }),
  )

  const popoverFilterCount = computed(() => activeFilterChips.value.length)

  const hasActiveFilters = computed(
    () =>
      search.value.trim() !== '' ||
      bookFilter.value !== 'all' ||
      notesOnly.value ||
      colors.value.length > 0 ||
      styleFilter.value !== 'all' ||
      originFilter.value !== 'all' ||
      dateFrom.value !== '' ||
      dateTo.value !== '',
  )

  function buildQuery(extra: Record<string, string> = {}): string {
    const params = new URLSearchParams()
    params.set('page', String(page.value))
    params.set('pageSize', String(pageSize.value))
    params.set('status', status.value)
    params.set('sortBy', sortBy.value)
    params.set('sortDir', sortDir.value)
    if (search.value.trim()) params.set('search', search.value.trim())
    if (colors.value.length > 0) params.set('colors', colors.value.join(','))
    if (styleFilter.value !== 'all') params.set('styles', styleFilter.value)
    if (originFilter.value !== 'all') params.set('origins', originFilter.value)
    if (bookFilter.value !== 'all') params.set('bookId', String(bookFilter.value))
    const from = toDayBoundaryIso(dateFrom.value, 'start')
    if (from) params.set('dateFrom', from)
    const to = toDayBoundaryIso(dateTo.value, 'end')
    if (to) params.set('dateTo', to)
    if (notesOnly.value) params.set('hasNote', 'true')
    for (const [key, value] of Object.entries(extra)) params.set(key, value)
    return params.toString()
  }

  let loadSeq = 0
  async function load() {
    const seq = ++loadSeq
    loading.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/annotations?${buildQuery()}`)
      if (seq !== loadSeq) return
      if (!res.ok) {
        error.value = 'Failed to load annotations'
        return
      }
      const body: AnnotationHubResponse = await res.json()
      if (seq !== loadSeq) return
      items.value = body.items
      total.value = body.total
      stats.value = body.stats
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  }

  async function searchBooks(q: string): Promise<AnnotationHubBookFacet[]> {
    const params = new URLSearchParams({ status: status.value })
    if (q.trim()) params.set('q', q.trim())
    const res = await api(`/api/v1/annotations/books?${params.toString()}`)
    if (!res.ok) return []
    return (await res.json()) as AnnotationHubBookFacet[]
  }

  async function resolveSelectedBook() {
    if (bookFilter.value === 'all') {
      selectedBookLabel.value = null
      return
    }
    if (selectedBookLabel.value) return
    const params = new URLSearchParams({ status: status.value, selectedId: String(bookFilter.value) })
    const res = await api(`/api/v1/annotations/books?${params.toString()}`)
    if (!res.ok) return
    const facets = (await res.json()) as AnnotationHubBookFacet[]
    const match = facets.find((facet) => facet.bookId === bookFilter.value)
    if (match) selectedBookLabel.value = match.bookTitle ?? 'Unknown book'
  }

  function toggleNotesOnly() {
    notesOnly.value = !notesOnly.value
  }

  function clearDates() {
    dateFrom.value = ''
    dateTo.value = ''
  }

  function clearPopoverFilters() {
    colors.value = []
    styleFilter.value = 'all'
    originFilter.value = 'all'
    clearDates()
  }

  function resetAllFilters() {
    search.value = ''
    bookFilter.value = 'all'
    selectedBookLabel.value = null
    notesOnly.value = false
    clearPopoverFilters()
  }

  function removeFilterChip(id: string) {
    if (id.startsWith('color:')) {
      const hex = id.slice('color:'.length)
      colors.value = colors.value.filter((value) => value !== hex)
      return
    }
    if (id === 'style') styleFilter.value = 'all'
    else if (id === 'origin') originFilter.value = 'all'
    else if (id === 'date') clearDates()
  }

  function hydrate(state: Partial<AnnotationsHubState>) {
    hydrating.value = true
    if (state.status !== undefined) status.value = state.status
    if (state.search !== undefined) search.value = state.search
    if (state.bookFilter !== undefined) bookFilter.value = state.bookFilter
    if (state.colors !== undefined) colors.value = state.colors
    if (state.styleFilter !== undefined) styleFilter.value = state.styleFilter
    if (state.originFilter !== undefined) originFilter.value = state.originFilter
    if (state.notesOnly !== undefined) notesOnly.value = state.notesOnly
    if (state.dateFrom !== undefined) dateFrom.value = state.dateFrom
    if (state.dateTo !== undefined) dateTo.value = state.dateTo
    if (state.sortKey !== undefined) sortKey.value = state.sortKey
    if (state.page !== undefined) page.value = state.page
    void nextTick(() => {
      hydrating.value = false
    })
  }

  async function bulk(action: 'trash' | 'restore' | 'restyle', patch?: { color?: string; style?: string }): Promise<number> {
    const ids = [...selection.selectedIds.value]
    if (ids.length === 0) return 0
    const res = await api('/api/v1/annotations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action, ...patch }),
    })
    if (!res.ok) return 0
    const body = (await res.json()) as { affected: number }
    selection.clearSelection()
    await load()
    return body.affected
  }

  async function restore(id: number): Promise<boolean> {
    const res = await api(`/api/v1/annotations/${id}/restore`, { method: 'POST' })
    if (res.ok) await load()
    return res.ok
  }

  async function purge(id: number): Promise<{ ok: boolean; message?: string }> {
    const res = await api(`/api/v1/annotations/${id}`, { method: 'DELETE' })
    if (res.ok) {
      await load()
      return { ok: true }
    }
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      return { ok: false, message: body?.message ?? 'Still pending device sync' }
    }
    return { ok: false, message: 'Failed to delete' }
  }

  function exportUrl(format: 'md' | 'csv' | 'json'): string {
    return `/api/v1/annotations/export?${buildQuery({ format })}`
  }

  function reloadFromFilterChange() {
    selection.clearSelection()
    if (page.value === 1) void load()
    else page.value = 1
  }

  watch([status, colors, styleFilter, originFilter, bookFilter, sortBy, sortDir, dateFrom, dateTo, notesOnly], () => {
    if (hydrating.value) return
    reloadFromFilterChange()
  })
  let searchDebounce: ReturnType<typeof setTimeout> | null = null
  watch(search, () => {
    if (hydrating.value) return
    if (searchDebounce) clearTimeout(searchDebounce)
    searchDebounce = setTimeout(reloadFromFilterChange, SEARCH_RELOAD_DEBOUNCE_MS)
  })
  watch(status, () => {
    if (hydrating.value) return
    bookFilter.value = 'all'
    selectedBookLabel.value = null
  })
  watch(page, () => {
    if (hydrating.value) return
    selection.clearSelection()
    void load()
  })

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    rangeStart,
    rangeEnd,
    loading,
    error,
    status,
    search,
    colors,
    styleFilter,
    originFilter,
    bookFilter,
    sortBy,
    sortDir,
    sortKey,
    dateFrom,
    dateTo,
    notesOnly,
    hydrating,
    activeFilterChips,
    popoverFilterCount,
    hasActiveFilters,
    selectedBookLabel,
    stats,
    selectedIds: selection.selectedIds,
    savingIds: mutations.savingIds,
    hasSelection: selection.hasSelection,
    allVisibleSelected: selection.allVisibleSelected,
    load,
    searchBooks,
    resolveSelectedBook,
    toggleSelected: selection.toggleSelected,
    clearSelection: selection.clearSelection,
    selectAllOnPage: selection.selectAllOnPage,
    toggleNotesOnly,
    clearDates,
    clearPopoverFilters,
    resetAllFilters,
    removeFilterChip,
    updateNote: mutations.updateNote,
    updateColor: mutations.updateColor,
    updateStyle: mutations.updateStyle,
    hydrate,
    bulk,
    restore,
    purge,
    exportUrl,
  }
}
