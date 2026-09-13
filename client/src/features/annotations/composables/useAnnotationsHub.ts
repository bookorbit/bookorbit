import { computed, nextTick, ref, watch } from 'vue'
import type { AnnotationHubBookFacet, AnnotationHubItem, AnnotationHubOverview, AnnotationHubResponse } from '@bookorbit/types'
import { api } from '@/lib/api'
import { HUB_VIEWS, type HubViewKey } from '../lib/hub-groups'
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
  needsReviewOnly: boolean
  dateFrom: string
  dateTo: string
  view: HubViewKey
}

const SEARCH_RELOAD_DEBOUNCE_MS = 300
const PAGE_SIZE = 50

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
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)

  const status = ref<HubStatus>('active')
  const search = ref('')
  const colors = ref<string[]>([])
  const styleFilter = ref('all')
  const originFilter = ref('all')
  const bookFilter = ref<number | 'all'>('all')
  const view = ref<HubViewKey>('newest')
  const dateFrom = ref('')
  const dateTo = ref('')
  const notesOnly = ref(false)
  const needsReviewOnly = ref(false)
  const hydrating = ref(false)

  const selectedBookLabel = ref<string | null>(null)
  const overview = ref<AnnotationHubOverview | null>(null)

  const selection = useAnnotationSelection(items)
  const mutations = useAnnotationMutations(items, (id) => items.value.find((item) => item.id === id)?.bookId ?? null)

  const spec = computed(() => HUB_VIEWS[view.value])
  const groupMode = computed(() => spec.value.group)
  const hasMore = computed(() => items.value.length < total.value)

  const popoverFilterCount = computed(
    () =>
      colors.value.length + (styleFilter.value !== 'all' ? 1 : 0) + (originFilter.value !== 'all' ? 1 : 0) + (dateFrom.value || dateTo.value ? 1 : 0),
  )

  const hasActiveFilters = computed(
    () =>
      search.value.trim() !== '' ||
      bookFilter.value !== 'all' ||
      notesOnly.value ||
      needsReviewOnly.value ||
      colors.value.length > 0 ||
      styleFilter.value !== 'all' ||
      originFilter.value !== 'all' ||
      dateFrom.value !== '' ||
      dateTo.value !== '',
  )

  function buildQuery(extra: Record<string, string> = {}): string {
    const params = new URLSearchParams()
    params.set('status', status.value)
    params.set('sortBy', spec.value.sortBy)
    params.set('sortDir', spec.value.sortDir)
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
    if (needsReviewOnly.value) params.set('needsReview', 'true')
    for (const [key, value] of Object.entries(extra)) params.set(key, value)
    return params.toString()
  }

  let loadSeq = 0
  async function load(append = false) {
    const seq = ++loadSeq
    const target = append ? page.value + 1 : 1
    if (append) loadingMore.value = true
    else loading.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/annotations?${buildQuery({ page: String(target), pageSize: String(PAGE_SIZE) })}`)
      if (seq !== loadSeq) return
      if (!res.ok) {
        error.value = 'failed'
        return
      }
      const body: AnnotationHubResponse = await res.json()
      if (seq !== loadSeq) return
      items.value = append ? [...items.value, ...body.items] : body.items
      total.value = body.total
      page.value = target
    } catch {
      if (seq === loadSeq) error.value = 'failed'
    } finally {
      if (seq === loadSeq) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  async function loadMore() {
    if (loading.value || loadingMore.value || !hasMore.value) return
    await load(true)
  }

  let overviewSeq = 0
  async function loadOverview() {
    const seq = ++overviewSeq
    const res = await api(`/api/v1/annotations/overview?${buildQuery()}`)
    if (seq !== overviewSeq || !res.ok) return
    overview.value = (await res.json()) as AnnotationHubOverview
  }

  async function refresh() {
    await Promise.all([load(), loadOverview()])
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
    if (match) selectedBookLabel.value = match.bookTitle ?? null
  }

  function toggleNotesOnly() {
    notesOnly.value = !notesOnly.value
  }

  function toggleNeedsReviewOnly() {
    needsReviewOnly.value = !needsReviewOnly.value
  }

  function toggleColor(hex: string) {
    colors.value = colors.value.includes(hex) ? colors.value.filter((value) => value !== hex) : [...colors.value, hex]
  }

  function toggleOrigin(origin: string) {
    originFilter.value = originFilter.value === origin ? 'all' : origin
  }

  function toggleBook(bookId: number, label: string | null) {
    if (bookFilter.value === bookId) {
      bookFilter.value = 'all'
      selectedBookLabel.value = null
      return
    }
    bookFilter.value = bookId
    selectedBookLabel.value = label
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
    needsReviewOnly.value = false
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
    if (state.needsReviewOnly !== undefined) needsReviewOnly.value = state.needsReviewOnly
    if (state.dateFrom !== undefined) dateFrom.value = state.dateFrom
    if (state.dateTo !== undefined) dateTo.value = state.dateTo
    if (state.view !== undefined) view.value = state.view
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
    await refresh()
    return body.affected
  }

  async function restore(id: number): Promise<boolean> {
    const res = await api(`/api/v1/annotations/${id}/restore`, { method: 'POST' })
    if (res.ok) await refresh()
    return res.ok
  }

  async function purge(id: number): Promise<{ ok: boolean; message?: string }> {
    const res = await api(`/api/v1/annotations/${id}`, { method: 'DELETE' })
    if (res.ok) {
      await refresh()
      return { ok: true }
    }
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      return { ok: false, message: body?.message }
    }
    return { ok: false }
  }

  async function trashOne(id: number): Promise<boolean> {
    const res = await api('/api/v1/annotations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], action: 'trash' }),
    })
    if (res.ok) await refresh()
    return res.ok
  }

  function exportUrl(format: 'md' | 'csv' | 'json'): string {
    return `/api/v1/annotations/export?${buildQuery({ format })}`
  }

  function reloadFromFilterChange() {
    selection.clearSelection()
    void refresh()
  }

  watch([status, colors, styleFilter, originFilter, bookFilter, view, dateFrom, dateTo, notesOnly, needsReviewOnly], () => {
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

  return {
    items,
    total,
    loading,
    loadingMore,
    hasMore,
    error,
    status,
    search,
    colors,
    styleFilter,
    originFilter,
    bookFilter,
    view,
    groupMode,
    dateFrom,
    dateTo,
    notesOnly,
    needsReviewOnly,
    hydrating,
    popoverFilterCount,
    hasActiveFilters,
    selectedBookLabel,
    overview,
    selectedIds: selection.selectedIds,
    savingIds: mutations.savingIds,
    hasSelection: selection.hasSelection,
    allVisibleSelected: selection.allVisibleSelected,
    load,
    loadMore,
    loadOverview,
    refresh,
    searchBooks,
    resolveSelectedBook,
    toggleSelected: selection.toggleSelected,
    clearSelection: selection.clearSelection,
    selectAllOnPage: selection.selectAllOnPage,
    toggleNotesOnly,
    toggleNeedsReviewOnly,
    toggleColor,
    toggleOrigin,
    toggleBook,
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
    trashOne,
    exportUrl,
  }
}
