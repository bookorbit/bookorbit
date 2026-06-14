import { computed, nextTick, ref, watch } from 'vue'
import type { AnnotationHubBookFacet, AnnotationHubItem, AnnotationHubResponse, AnnotationHubStats } from '@bookorbit/types'
import { api } from '@/lib/api'
import { colorLabel, originLabel, styleLabel, type SortKey } from '../lib/filter-options'

export type HubStatus = 'active' | 'trashed'

export type PopoverFilterKey = 'color' | 'style' | 'origin' | 'date'

export interface ActiveFilterChip {
  key: PopoverFilterKey
  label: string
}

/** The slice of hub state that can be restored from the URL on load. */
export interface AnnotationsHubState {
  status: HubStatus
  search: string
  bookFilter: number | 'all'
  colorFilter: string
  styleFilter: string
  originFilter: string
  notesOnly: boolean
  dateFrom: string
  dateTo: string
  sortKey: SortKey
  page: number
}

function dateRangeLabel(from: string, to: string): string {
  if (from && to) return `${from} to ${to}`
  if (from) return `From ${from}`
  return `Until ${to}`
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
  const colorFilter = ref('all')
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
  const selectedIds = ref<Set<number>>(new Set())
  const savingIds = ref<Set<number>>(new Set())

  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const hasSelection = computed(() => selectedIds.value.size > 0)
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

  const activeFilterChips = computed<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = []
    if (colorFilter.value !== 'all') chips.push({ key: 'color', label: `Color: ${colorLabel(colorFilter.value)}` })
    if (styleFilter.value !== 'all') chips.push({ key: 'style', label: `Style: ${styleLabel(styleFilter.value)}` })
    if (originFilter.value !== 'all') chips.push({ key: 'origin', label: `Source: ${originLabel(originFilter.value)}` })
    if (dateFrom.value || dateTo.value) chips.push({ key: 'date', label: `Date: ${dateRangeLabel(dateFrom.value, dateTo.value)}` })
    return chips
  })

  const popoverFilterCount = computed(() => activeFilterChips.value.length)

  const hasActiveFilters = computed(
    () =>
      search.value.trim() !== '' ||
      bookFilter.value !== 'all' ||
      notesOnly.value ||
      colorFilter.value !== 'all' ||
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
    if (colorFilter.value !== 'all') params.set('colors', colorFilter.value)
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

  async function load() {
    loading.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/annotations?${buildQuery()}`)
      if (!res.ok) {
        error.value = 'Failed to load annotations'
        return
      }
      const body: AnnotationHubResponse = await res.json()
      items.value = body.items
      total.value = body.total
      stats.value = body.stats
    } finally {
      loading.value = false
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

  function toggleSelected(id: number) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  function selectAllOnPage() {
    selectedIds.value = new Set(items.value.map((item) => item.id))
  }

  function toggleNotesOnly() {
    notesOnly.value = !notesOnly.value
  }

  function clearDates() {
    dateFrom.value = ''
    dateTo.value = ''
  }

  function clearPopoverFilters() {
    colorFilter.value = 'all'
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

  function removeFilterChip(key: PopoverFilterKey) {
    switch (key) {
      case 'color':
        colorFilter.value = 'all'
        break
      case 'style':
        styleFilter.value = 'all'
        break
      case 'origin':
        originFilter.value = 'all'
        break
      case 'date':
        clearDates()
        break
    }
  }

  function hydrate(state: Partial<AnnotationsHubState>) {
    hydrating.value = true
    if (state.status !== undefined) status.value = state.status
    if (state.search !== undefined) search.value = state.search
    if (state.bookFilter !== undefined) bookFilter.value = state.bookFilter
    if (state.colorFilter !== undefined) colorFilter.value = state.colorFilter
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

  function setSaving(id: number, saving: boolean) {
    const next = new Set(savingIds.value)
    if (saving) next.add(id)
    else next.delete(id)
    savingIds.value = next
  }

  async function updateAnnotation(bookId: number, id: number, patch: { note?: string | null; color?: string; style?: string }) {
    const previous = items.value
    items.value = items.value.map((item) => (item.id === id ? { ...item, ...patch } : item))
    setSaving(id, true)
    try {
      const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) items.value = previous
    } catch {
      items.value = previous
    } finally {
      setSaving(id, false)
    }
  }

  async function bulk(action: 'trash' | 'restore' | 'restyle', patch?: { color?: string; style?: string }): Promise<number> {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return 0
    const res = await api('/api/v1/annotations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action, ...patch }),
    })
    if (!res.ok) return 0
    const body = (await res.json()) as { affected: number }
    clearSelection()
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
    page.value = 1
    clearSelection()
    void load()
  }

  watch([status, colorFilter, styleFilter, originFilter, bookFilter, sortBy, sortDir, dateFrom, dateTo, notesOnly], () => {
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
    clearSelection()
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
    colorFilter,
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
    selectedIds,
    savingIds,
    hasSelection,
    load,
    searchBooks,
    resolveSelectedBook,
    toggleSelected,
    clearSelection,
    selectAllOnPage,
    toggleNotesOnly,
    clearDates,
    clearPopoverFilters,
    resetAllFilters,
    removeFilterChip,
    updateAnnotation,
    hydrate,
    bulk,
    restore,
    purge,
    exportUrl,
  }
}
