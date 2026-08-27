import { watch } from 'vue'
import { useRoute, useRouter, type LocationQuery, type LocationQueryRaw } from 'vue-router'
import { isHubViewKey } from '../lib/hub-groups'
import type { AnnotationsHubState, useAnnotationsHub } from './useAnnotationsHub'

type Hub = ReturnType<typeof useAnnotationsHub>
const SEARCH_WRITE_DELAY_MS = 300

function firstString(value: LocationQuery[string] | undefined): string | undefined {
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === 'string' ? first : undefined
  }
  return typeof value === 'string' ? value : undefined
}

/** Restores the saved filter/sort/page slice from a URL query (ignoring unknown or malformed values). */
export function annotationsStateFromQuery(query: LocationQuery): Partial<AnnotationsHubState> {
  const state: Partial<AnnotationsHubState> = {}

  if (firstString(query.status) === 'trashed') state.status = 'trashed'

  const search = firstString(query.search)
  if (search) state.search = search

  const bookId = firstString(query.bookId)
  if (bookId) {
    const parsed = Number(bookId)
    if (Number.isInteger(parsed) && parsed > 0) state.bookFilter = parsed
  }

  const colorsParam = firstString(query.colors)
  if (colorsParam) {
    const list = colorsParam.split(',').filter(Boolean)
    if (list.length > 0) state.colors = list
  }

  const style = firstString(query.style)
  if (style) state.styleFilter = style

  const origin = firstString(query.origin)
  if (origin) state.originFilter = origin

  if (firstString(query.notes) === '1') state.notesOnly = true

  if (firstString(query.review) === '1') state.needsReviewOnly = true

  const from = firstString(query.from)
  if (from) state.dateFrom = from

  const to = firstString(query.to)
  if (to) state.dateTo = to

  const view = firstString(query.view)
  if (view && isHubViewKey(view)) state.view = view

  return state
}

/** Serializes the current hub state into a minimal query (defaults are omitted). */
export function annotationsQueryFromState(state: AnnotationsHubState): LocationQueryRaw {
  const query: LocationQueryRaw = {}
  if (state.status !== 'active') query.status = state.status
  const search = state.search.trim()
  if (search) query.search = search
  if (state.bookFilter !== 'all') query.bookId = String(state.bookFilter)
  if (state.colors.length > 0) query.colors = state.colors.join(',')
  if (state.styleFilter !== 'all') query.style = state.styleFilter
  if (state.originFilter !== 'all') query.origin = state.originFilter
  if (state.notesOnly) query.notes = '1'
  if (state.needsReviewOnly) query.review = '1'
  if (state.dateFrom) query.from = state.dateFrom
  if (state.dateTo) query.to = state.dateTo
  if (state.view !== 'newest') query.view = state.view
  return query
}

function sameQuery(next: LocationQueryRaw, current: LocationQuery): boolean {
  const nextKeys = Object.keys(next)
  if (nextKeys.length !== Object.keys(current).length) return false
  return nextKeys.every((key) => String(next[key]) === firstString(current[key]))
}

/**
 * Two-way binds the annotations filter and view state to the URL query: hydrates the hub from
 * the query on setup, then mirrors later changes back via `router.replace` so refresh, bookmark,
 * and share restore the exact view without polluting browser history. Search writes are debounced.
 */
export function useAnnotationsUrlSync(hub: Hub) {
  const route = useRoute()
  const router = useRouter()

  hub.hydrate(annotationsStateFromQuery(route.query))
  void hub.resolveSelectedBook()

  function snapshot(): AnnotationsHubState {
    return {
      status: hub.status.value,
      search: hub.search.value,
      bookFilter: hub.bookFilter.value,
      colors: hub.colors.value,
      styleFilter: hub.styleFilter.value,
      originFilter: hub.originFilter.value,
      notesOnly: hub.notesOnly.value,
      needsReviewOnly: hub.needsReviewOnly.value,
      dateFrom: hub.dateFrom.value,
      dateTo: hub.dateTo.value,
      view: hub.view.value,
    }
  }

  function write() {
    if (hub.hydrating.value) return
    const query = annotationsQueryFromState(snapshot())
    if (sameQuery(query, route.query)) return
    void router.replace({ query })
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  watch(hub.search, () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(write, SEARCH_WRITE_DELAY_MS)
  })

  watch(
    [
      hub.status,
      hub.bookFilter,
      hub.colors,
      hub.styleFilter,
      hub.originFilter,
      hub.notesOnly,
      hub.needsReviewOnly,
      hub.dateFrom,
      hub.dateTo,
      hub.view,
    ],
    write,
  )
}
